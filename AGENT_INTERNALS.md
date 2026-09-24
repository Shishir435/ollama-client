# Browser agent internals

Detail for work touching `src/lib/browser-agent/`, `src/background/agent/`,
`src/application/agent/`, `packages/agent-runtime/` or `src/features/agent/`,
plus three files these rules also govern from outside those directories:
`packages/contracts/src/agent-keys.ts`, `src/lib/browser-sessions.ts` and
`src/lib/tools/internal/browser-session-tools.ts`.

`AGENTS.md` carries the agent invariants an assistant must not violate without
reading further. This file carries the reasons — each rule exists because
something broke, and the clause explaining it is what stops it being undone.
Read the section your change touches; you do not need the whole file.

## Contents

- [Session lifecycle and attachment](#session-lifecycle-and-attachment)
- [Perception: frames and identity](#perception-frames-and-identity)
- [Perception: reachability](#perception-reachability)
- [Projection and targeted reads](#projection-and-targeted-reads)
- [Progress, refusals and findings](#progress-refusals-and-findings)
- [Input delivery](#input-delivery)
- [Forms, editors and drags](#forms-editors-and-drags)
- [Native dialogs](#native-dialogs)
- [Policy: pricing and consent](#policy-pricing-and-consent)
- [Follow-up runs](#follow-up-runs)
- [Verification, waiting and completion](#verification-waiting-and-completion)
- [Screenshots](#screenshots)
- [Supervision receipts and the work log](#supervision-receipts-and-the-work-log)
- [Recovery evidence](#recovery-evidence)
- [Read-only session tools and capture](#read-only-session-tools-and-capture)
- [Starting a run from chat](#starting-a-run-from-chat)
- [Panel supervision surface](#panel-supervision-surface)
- [Measured behaviour and benchmarks](#measured-behaviour-and-benchmarks)
- [Task-completion contracts](#task-completion-contracts)

## Session lifecycle and attachment

- Chromium Agent debugger attachments belong only to
  `src/background/agent/agent-browser-session-manager.ts`. Raw CDP targets stay
  inside that adapter and never become model tools. This is a rule about
  extension code: `chrome.debugger` attachments taken against the user's tab
  in the shipped product. It does not reach `tools/verify/**`, where a Node
  runner drives Chromium's own DevTools endpoint from outside the extension
  to kill and restart the worker — the thing under test cannot own the switch
  that kills it, and nothing there ships or is reachable by a model. Attach only after the run
  service authorizes the tab the run starts on (the one the side panel showed
  when the message was sent, unless the start prompt named another); detach at pause, takeover, stop,
  completion, and failure boundaries — except a pause the run comes back from
  on the same page (user, question, unresolved effect) while a native dialog
  is held, which keeps the session so the dialog is not dismissed (see
  [Native dialogs](#native-dialogs)). An unexpected disconnect pauses the run,
  and an interrupted effect remains unresolved rather than being replayed.
- **An unresolved effect is resolved by the supervisor, not by a guess.**
  `resolveEffect` records that the user has looked at the page and continues
  the run from a fresh observation, with the generation bumped so no reference
  bound before the page moved survives. Nothing is replayed and nothing is
  asserted about what happened — the run decides from what is on screen. It
  names the `pausedAt` it is resolving, so a click on a stale panel cannot
  resolve whatever replaced it — checked in the run service *before* the
  debugger is attached, not only in the controller afterwards, because a
  rejected resolve crosses no pause boundary and the detach hook that runs at
  one would never fire: the tab kept the debugging banner with the run still
  paused. Stop used to be the only exit, and that was
  the more dangerous arrangement: a stopped run is started again from the
  goal, and the new run carries no memory that the click already landed, so
  refusing to continue is what made the action likely to happen twice.
- Firefox receives no `debugger` permission. The session manager reports the
  existing DOM control backend with `cdpControl: false` and
  `frameTracking: false`; do not claim CDP-only capabilities there.
- **The debugger's frame tree is tracked, not guessed.** After attach, the
  session manager enables `Page`, flattens auto-attach for out-of-process
  frames, and follows frame events on every session. `mapFrame` joins an
  extension frame onto that tree only when the join is exact — the root, or
  the single frame under the mapped parent with that URL. Ambiguous siblings
  and unknown parents are reported as unmapped; a command aimed at a guessed
  frame is an effect nobody approved.
- **Tab scope is a run's, not a site's.** `scopedTabIds` holds the tab the
  user started on and every tab the run opened itself; `switch_tab` to any
  other tab raises an approval whatever the site allowlist says, and the tab
  joins the scope in the same claim that moves the run onto it. The debugger
  attachment follows the controlled tab in that write, before any page work
  is claimed there.

## Perception: frames and identity

- **Identity is per frame.** `AgentSnapshotIdentity` names a tab, a frame, a
  document and a generation; every frame keeps its own reference store, and a
  child frame's references carry the frame in their prefix (`f7e2`), so `e1`
  is never the same control in two frames. The command names the root
  snapshot; the executor binds the effect to the target's own frame identity
  (`target.frame`) and re-reads that frame's document before acting. Never
  hardcode `frameId: 0` again — a literal zero is how a child-frame control
  gets resolved against the wrong document.
- **A frame is read only once the run may read it.** The registry lists the
  tab's frames, and each child passes the browser's limits, the user's
  exclusions and the run's origin allowlist before its port is opened. A frame
  that fails any of them is listed in `observation.frames` with its origin and
  the reason, never its URL, and contributes no elements; the model is told it
  exists so it can ask rather than conclude the control is missing.
  `about:blank` and `srcdoc` frames have no origin and are omitted.
- **Frames and elements are bounded together.** Root first, then children in
  frame-id order up to `MAX_AGENT_OBSERVED_FRAMES`; frames past the cap are
  counted in `omittedFrames`, never listed, so the list itself honours the
  contract. A child receives only the element budget the frames before it
  left, and a child that cannot fit or cannot be read is listed as such rather
  than truncated or retried.
- **Perception reads the composed tree, not the light DOM.** Candidate
  selection and both text walks descend into open shadow roots at their host,
  so a component's controls and text are observed like any other; every node
  tree is walked once, so a `<slot>` never double-counts the light child it
  projects. A closed shadow root reads as `null` and stays unread rather than
  guessed at. The walk is `nodeType`-based, not `instanceof Element` — the same
  observation runs against a child frame's own realm.

## Perception: reachability

- **Off the fold and out of reach are different answers.** `resolveVisibility`
  is a conjunction, so a below-fold row collapses into the same `false` as a
  `display:none` one; `isOffscreen` asks the question separately so the row
  keeps its name. What it must not do is answer it from layout alone — a
  control clipped to nothing by an ancestor that *cannot scroll*
  (`overflow: hidden`/`clip`, `contain: paint`: a closed accordion, a carousel
  track) is not a control a scroll brings into reach, and naming it as one
  sends the run scrolling for something that is not coming.
  `isUnreachablyClipped` walks the same ancestors as visibility with the
  scrollable ones deliberately skipped, because a row below the fold of a
  scroll pane is exactly what this is for.
- **A covered control is not a clickable one.** A laid-out, in-viewport element
  whose click points all hit-test to some unrelated element is marked
  `occluded`; it is still listed — the control exists — so the model dismisses
  the cover or scrolls rather than clicking a point the pointer cannot reach.
  An indeterminate hit test (no layout, or a `null` answer) reports no
  occlusion: a covered control wrongly shown is recoverable, a reachable one
  wrongly hidden is not.

## Projection and targeted reads

- **WebMCP is an optional page capability, never an authority.**
  `WXT_AGENT_WEBMCP=1` includes the experimental Chromium adapter; the runtime
  still feature-detects `document.modelContext` in each readable frame and
  ordinary DOM control remains the fallback. Tool names, descriptions,
  schemas, annotations and results are page-authored untrusted data.
  `readOnlyHint` never lowers policy and `consequentialHint` may only raise it.
  Until a trusted classifier exists, every page-tool call is conservatively
  classified as destructive and requires fresh critical approval.
- **A page-tool call is bound twice.** Discovery records the tab frame,
  browser document id and a digest of the advertised schema; execution
  re-discovers immediately before calling page code and refuses a changed
  digest. A rejected or aborted invocation is never replayed through DOM: once
  page code may have run, any lost acknowledgement stays an unresolved effect.

- **The window is resolved from the model, not written beside it.**
  `resolveAgentContextWindow` (`agent-context-window.ts`) takes the *smallest*
  figure the server's own allocation (`/api/show` `num_ctx`), the weights'
  metadata (`*.context_length`) and the catalog report, and falls back to what
  the agent has always reached when told nothing. A user setting overrides all
  of it in both directions. Resolved **once per run** — recomputing it per
  request made `num_ctx` drift step to step, and a local runner reloads the
  model when it moves.
- **The page is one budget claimant, not the whole prompt.** The context
  window is partitioned across instructions, tools, history, output and page
  content (`agent-model-port.ts`); the page gets the remainder and is projected
  to fit it. Every other claimant is bounded against the window too — the
  history keeps its newest entries, the answer allowance is sized by whether
  the page holds an editable text control at all. Bounding only the page held
  while the window was a literal at least as large as the others could grow;
  once it is resolved, an 8k model meets a twelve-step history and the page is
  trimmed to nothing while the request still overflows. A large application does not send every control — the overview
  keeps the focused control, the reachable ones and whatever fits in document
  order, and reports the rest in `omittedByGroup` so a control the budget
  dropped is discoverable, not silently absent. No budget preserves the whole
  projection.
- **A bounded overview is drilled into, not scrolled through.** Four read-only
  commands reveal what the overview summarised: `inspect` expands a region by
  its group, `find` surfaces controls matching a query, `extract` answers up to
  six queries in one walk of the document, `extract_text` returns the page's
  full text — the below-fold document the overview omits. None
  mutates the page, so all resolve as `read` and ask no approval. What to expand
  is derived from the previous step's own durable command
  (`currentAgentInspection`), so the next observation shows exactly what was
  asked and a worker restart rebuilds it — no separate run state. An expansion
  is still bounded by a hard ceiling (`pageContentMaxChars`, set from the
  context ceiling), so a two-thousand-control region or a maximal text extract
  cannot push the prompt past the window and truncate the system prompt.
- **A lookup is asked of every frame the run may read; a scope is not.**
  `extract` sends its questions to the root document and to each authorized
  child frame, and composition merges the answers into the group that asked
  for them, applying the per-question bound *after* the merge. It has to reach
  the frames: an empty group means "no such control", and a run told that
  about a control inside an authorized iframe stops looking for something that
  is there. A scope stays root-only because its answer is a count and a
  continuation offset, neither of which composes across documents. A frame
  answering a lookup is capped at one group per question rather than the whole
  remaining element budget, since a frame that matched nothing falls back to
  its overview — and that room is *reserved before the root is asked*, because
  the root falls back the same way and on a crowded page its consolation
  overview spent the whole budget before any frame was reached. A frame the
  budget still stopped marks every group `truncated`: the bound ended the
  search, not the page. A frame the run may not read does not, since the frame
  list already says so and an advertising frame would otherwise make the flag
  meaningless.
- **A read-only request that matched nothing says so.** A region is matched by
  the exact group name the observation publishes — `page` included, which is
  the name omissions outside any landmark are reported under and was for a
  while the one published region that could never match. A miss is reported as
  `unmatched`, with the regions the page does have, because the answer to a
  misnamed region is otherwise byte-identical to the answer to a real one and
  a model has no way to learn: one run spent twenty-one of its twenty-five
  observations asking for the same absent region.

## Progress, refusals and findings

- **A confirmed step is not the same thing as progress, and the no-progress
  guard must not be told otherwise.** It failed to fire on a run that repeated
  one request twenty-one times, and the reason was that idea written down
  three separate times:
  - `classifyNoProgress` required an identical observation hash. A changed
    page is normally proof the run got somewhere, but that does not hold for
    `inspect` and `find` — the run changed nothing, so the page moving is not
    its progress, and a live application moves between every pair of
    observations. Those two compare the requested controls, ignoring unrelated page text and
    layout churn while accepting new matching controls or changed values as progress. `read` and
    `extract_text` keep the hash test, because for those the observation *is*
    the answer and a changed page is a different answer.
  - The controller cleared the guard's memory after every confirmed
    verification. A pure read verifies `confirmed` by definition, so a repeat
    could never accumulate. It is cleared on `agentEffectChangesPage(effect)`
    now — navigation needs no exemption, since going somewhere changes the url
    the guard compares first.
  - `classifyNoProgress` took a `verificationOutcome` input that reset the
    count on `confirmed`. Nothing ever passed it, and wiring it as written
    would have made the loop unkillable. It is gone; do not reintroduce it.
- **A refused command is told to the model, not made fatal.** The resolver
  refusing to ground a command means nothing was attempted, so the run has
  lost nothing: it records a rejected step carrying the affordance layer's own
  sentence — assembled from templates and the model's ref, never from page
  text — and looks again, exactly as a declined completion does. Three
  consecutive refusals now pause with a question so the user can correct the
  approach; the older `command_refused` error remains readable for saved runs. Failing on the first
  one answered a well-formed decision with `invalid_decision`, whose advice
  tells the user to find a larger model — wrong about what happened, and often
  wrong about whose fault it was, since a control the observation offered can
  be gone by the time the resolver reads the page.

  Most refusals never reach the resolver: `agent-decision-parser.ts` asks the
  same classifier the same question of the same observation, where a wrong
  answer costs one retry instead of a step. What reaches the resolver is what
  that check cannot see — a live hit test, a dialog that opened, a screenshot
  that is no longer there.
- **A finding outlives the history window.** `finding` on a decision is kept in
  a dedicated store (`buildAgentFindings`), bounded by count and bytes, carrying
  the redacted page each was recorded on. It is the run's own note and stays
  untrusted page-derived data, never an instruction, so a fact learned on step
  two survives to step fifty without letting the page it came from change the
  goal.

## Input delivery

- **Native input is chosen before the action and never swapped after it.**
  `chooseAgentInputBackend` (`native-input.ts`) decides `cdp` or `dom` from the
  command, the resolved target and whether the run holds the tab's debugger
  and can place the target's frame. Link activation, form submission,
  Enter-on-a-submitting-field and a newline typed into one stay on the
  guarded DOM paths whatever is attached — those paths exist so page handlers
  cannot redirect an approved destination, and a native click or Enter would
  hand it back to the page. A chord on a character the key table cannot press
  has no native form and goes to the DOM path too. Once a
  native step has been sent, a failure is an unresolved effect; it is not
  completed through the content script. Only a plan the debugger refused from
  its first step is a clean `AgentEffectNotAppliedError`.
- **A native plan is a sequence the runner owes a release for.**
  `runAgentNativeInputPlan` sends one step at a time, checks cancellation
  between steps, and on abort or dispatcher failure releases every held button
  and key (reverse order) before throwing with the count dispatched. It never
  re-sends a step. `Input.*` and `DOM.*` method names live only in the session
  manager, behind `nativeInput(runId, tabId)`; the planner speaks in steps.
- **The page picks the point, the debugger places the frame.** Preparation
  (`prepareAgentNativeInputInDocument`) runs the same target guards as
  synthetic execution, scrolls the element into view, takes the first
  hit-testable point from the occlusion sampler, and arms an input record —
  all in one synchronous pass. Coordinates are the frame's own viewport
  pixels; the background adds the frame's root offset from the debugger's
  frame tree (`DOM.getFrameOwner` + `DOM.getBoxModel`, one hop per session),
  so a child document cannot steer a click by misreporting where it sits.
- **Delivery is matched, not assumed.** The page records trusted
  `mousemove/mousedown/mouseup/keydown/keyup/wheel` while a plan is in flight;
  `assessAgentInputDelivery` matches the record against the plan. A
  state-changing event the plan did not send is `interference` (a real hand on
  the page), and the verifier pauses the step as unresolved rather than
  crediting or retrying it; stray `mousemove`s are ignored because the browser
  synthesizes them after layout. A key's release is not judged for target —
  after Tab it lands on the next control. `misdirected`, `partial`,
  `undelivered` and `unknown` (the document navigated before it could answer,
  or the plan was inserted text with no events to match) are told apart on
  the receipt. Native and user events are both trusted, so this is the only
  discriminator there is — a user event that exactly matches the plan is
  indistinguishable, and the limitation is stated rather than papered over.
- `double_click` and `hover` are element actions in the DOM-mutation family;
  `press_key` accepts chords (`Shift+Tab`, `Control+a`) through the grammar in
  `packages/contracts/src/agent-keys.ts`. Select-all and move-to-end travel as
  CDP editing commands, not platform shortcuts, so a plan is the same on every
  OS. Native `<select>`, `check` and `uncheck` stay synthetic: a native option
  popup cannot be driven, and a checked state is stated, not toggled.
- Firefox has no debugger: `double_click` and `hover` degrade to synthetic
  events there, the receipt says `backend: "dom"`, and the hover verifier
  then needs page evidence, since no delivery record exists.

## Forms, editors and drags

- **A batch changes who asks, never what is checked.** `fill_form` sets up to
  twelve controls from one decision, because a decision costs seconds and an
  observation costs tens of milliseconds. Each field carries a whole grounded
  command and goes through the same executor, the same target recheck and the
  same refusal vocabulary as the single-field command it mirrors; the
  classifier answers every per-field question before anything is attempted and
  reports the **index** of the field it refused, since a twelve-field batch
  refused without one is unactionable.
- **A batch cannot click, so it cannot submit.** That is what makes one
  approval for it honest: the submission stays its own step with its own
  prompt. A sensitive control is refused out of the batch by name, so the
  model repeats that field alone and the takeover path can offer it properly.
- **One approval, the disclosure of all of them.** The prompt names the count
  *and* every control the batch will set, one line per field, from each
  resolved target's own accessible name (`batchEvidence` in `policy.ts`);
  a control the page left unnamed is listed by its role, input type or tag
  rather than dropped. Naming the first of twelve was a weaker prompt than the
  twelve it replaced, which is the one thing batching may not cost. What the
  consequence claims stops at what the run knows: the batch presses nothing,
  so it cannot submit — but a page that saves as you type may have stored each
  change already, and the old wording ("nothing is submitted") read as
  "nothing is kept".
- **A batch re-baselines the payload it is changing.** Both the private form
  state and the wire target's `formFingerprint` hash the form's values, so the
  batch's own first edit moves them and its second field is refused for the
  change it just made. Each applied edit refreshes both for the fields still
  to come. Anything *this batch did not do*, arriving between two of its own
  edits, still moves them and is still caught.
- **A batch never throws away how far it got.** It stops at the first field it
  cannot place and reports the count, which is the one fact the run cannot
  reconstruct from the page afterwards — a run that cannot tell three fields
  written from none writes three of them twice. A batch that placed *nothing*
  is a refusal like any other: nothing happened, so the run records a rejected
  step and looks again.

- **A submission runs the page's handlers first, then enforces the
  destination.** `submitThroughPageHandlers` calls the form's own
  `requestSubmit` and listens last. A handler that calls `preventDefault` is
  an application submitting for itself: nothing navigates, no destination is
  reported, and the verifier judges the step by what the page did. A handler
  that does not prevent the default leaves the browser about to navigate to
  whatever `action` says *now*, which the handler may just have rewritten —
  so the default is cancelled there and the approved destination is submitted
  from a fresh form carrying only the bound standard controls. Submitting
  that copy unconditionally, as this used to, navigated single-page forms
  away while the application never saw its own event.
- **An approved effect is bound to a control, not to a moment of its state.**
  `assertUnchangedMutationTarget` compares identity, kind, destination and
  sensitivity; it does not compare live `value`, `focused` or `checked`,
  which a page rewrites on its own while a model spends seconds deciding.
  Only the commands whose text was computed from the field — `type`,
  `clear_and_type`, `replace_text` — still require the value they were built
  from. A key press focuses the control it names rather than refusing because
  focus moved: refusing delivered nothing and stopped a run the moment a
  page's own widget took focus, while a real hand on the page is caught by
  input-delivery interference, which is evidence rather than a guess.
- **The form fingerprint is the payload, not the paint.**
  `privateFormState` hashes what the form would submit — action, method,
  enctype, target, and each control's submission attributes, value, checked
  and selected state. It used to hash every attribute of every control, so a
  search widget flipping `aria-expanded` as its suggestion list opened
  changed the fingerprint and the run refused to press Enter in the box it
  had just filled in. Class and ARIA state cannot reach the wire, so
  comparing them bought nothing and cost every live form on the web. A value
  edited elsewhere in the form, a rewritten hidden token and a control
  disabled into silence all still refuse.
- **An editor is edited through the browser's own editing pipeline, never by
  writing its DOM.** A `contenteditable` host is observed as a control of type
  `contenteditable` whose value is its flattened text; `type` appends,
  `clear_and_type` replaces all, and `replace_text` replaces one exact
  occurrence of `find`. The page-side helpers (`editor-page.ts`) place the
  selection or caret and drive `execCommand`/`insertText`, so a rich-text
  editor that rebuilds its DOM from its own model keeps the change. Value
  comparison flattens markup the one way every side does (`editor-text.ts`), so
  a paragraph rendered as `<p>` on one read and `<div><br></div>` on the next
  is not a spurious change. Typed text never presses Enter — a newline is
  inserted as a line break, allowed only in a `multiline` field — because Enter
  is a submission or send that `press_key` must choose on purpose.
- **A drag is grounded on both ends and verified by the arrangement it
  leaves.** `drag` names a source `ref` and a destination `to`, both observed
  and in one frame; the destination is rechecked before the pointer moves. The
  native channel presses on the source and, if a held move makes the browser
  start an HTML5 drag (`Input.dragIntercepted`), drives it with drag events and
  drops with the drag data — otherwise the move stays a pointer drag a
  library reads. A stopped drag is cancelled, never dropped. The verifier
  confirms only a changed arrangement — the item moved past its destination,
  into another region, among different neighbours, or off the page — never the
  page merely having changed. Firefox and the DOM backend send the synthetic
  pointer-and-HTML5 sequence in `drag-page.ts`.
- **A file chooser is the user's, and the debugger holds it back.**
  `Page.setInterceptFileChooserDialog` is enabled on attach, so a click on a
  file input opens nothing; the run records `file_selection`, policy raises a
  `file_upload` takeover, and detaching for the takeover lets the user's own
  click open the chooser. A chooser the page opened mid-action is reported on
  the receipt (`fileChooser`) and settles the step as the user's whatever else
  happened.
- **An empty attachment picker does not make a form sensitive.** Submitting a
  comment with no selected files follows normal submission approval. Selected
  files, an unreadable selection, and password/OTP/card controls still require
  takeover. The executor rechecks selection after approval; the file picker
  itself remains sensitive even when empty.

## Native dialogs

- **A native dialog holds the page, and only the debugger can see it or let
  go of it.** Enabling `Page` is what makes `alert`, `confirm`, `prompt` and
  `beforeunload` reach `Page.javascriptDialogOpening` instead of the user, so
  an unanswered one is a tab frozen for as long as the run holds it. The
  session manager records the held dialog with an id minted from a
  never-resetting counter (`openDialog`), and `release` dismisses whatever is
  still held before detaching — dismissal confirms nothing and keeps a
  `beforeunload` on the page, and detaching for a takeover is what lets the
  user's own click raise a fresh dialog.
- **A pause does not answer a held dialog.** A dismissed `confirm` is the page
  being told "no", so detaching at every pause cancelled whatever the run had
  just asked for: a user who paused while a Delete button's confirmation was
  held came back to an undeleted item, a model that pressed Delete again and
  a second approval for one decision. `releaseBrowserSessionFor` therefore
  keeps the session — and the dialog — through a `pause_requested` or
  `paused` state whose reason is `user`, `question` or `unresolved_effect`
  whenever `openDialog` reports one; resuming re-attaches
  idempotently, observes the same dialog, and asks about it once. The tab
  stays blocked while paused, which is what the page itself would do with its
  dialog on screen. Closing the last panel releases even a dialog held by an
  earlier pause. A takeover, a lost browser, every stop and every terminal
  state also let go.
- **A blocked page is observed as blocked, not asked.** A dialog blocks the
  document's script, so no control port can answer: every observation the run
  takes goes through one seam in `agent-browser-adapters.ts`, which reports
  the tab, the dialog and a root frame marked `unreadable` — no elements, no
  text — rather than waiting on a page that will not reply. Its generation
  follows the last real observation and its snapshot names the dialog, so a
  command grounded in it cannot be replayed against the page afterwards. The
  verifier shares that seam, so a second dialog cannot leave it waiting
  either.
- **A dialog belongs to the document that opened it, not to the tab.**
  `Page.javascriptDialogOpening` names that document, which is the only way to
  tell the page's own `confirm` from an embedded frame's — and a frame's
  dialog blocks the whole tab either way. The origin travels on
  `AgentDialogState`, a document with none of its own (`about:blank`, `srcdoc`,
  an unreadable URL) is recorded as `"null"` so no allowlist matches it, and
  the adapter withholds `message` and `defaultPrompt` for an origin outside
  the run's allowlist — a dialog's text is frame content, governed by the same
  authorization as a frame's elements. The run is told the dialog exists, on
  which origin, and that it could not be read (`unauthorizedOrigin`), because
  a prompt it cannot see is different from one that is not there. The resolver
  sets `frameOrigin` for such a dialog, so policy judges the answer, its grant
  offer and its allowlist against the site that asked.

  The document the tab shows is the exception to the withholding, and
  deliberately: `observeRoot` is not allowlist-gated either — the root frame
  is the page the user pointed the run at, and `allowedOrigins` governs where
  the run may travel and act, not what the page in front of it may say — so
  withholding an `alert` from a page whose whole body text is already
  readable would be a stricter rule for the box on top than for the page
  under it, and would blind the run to a legitimate dialog after any redirect
  it did not itself approve.
- **Answering a dialog is priced against the origin that raised it, root
  frame included.** Reading one and answering it are different questions.
  Every other effect on an unapproved top-level origin already costs an
  approval by its own class — an activation is high whatever page it is on —
  but a dismissal is low, so a page that navigated itself somewhere the run
  never approved would otherwise have its dialogs answered for free.
  `baselineRisk` therefore raises a `handle_dialog` on any acting origin
  outside the allowlist, and the approval names that origin rather than
  calling it "the page".
- **A dialog is answered by identity, in its own action family.**
  `handle_dialog` names the `dialogId` the observation listed; `resolve`,
  `execute` and `verify` live in the `dialog` family, and the executor checks
  the tab but never the document. An answer whose prompt is no longer the one
  held is an `AgentEffectNotAppliedError`, never an answer given to whatever
  replaced it. Every other command is refused while a dialog is open
  (`dialog_open`, in `assertLiveObservation` so no family can forget it), and
  the classifier refuses the same thing at parse time so it costs a retry.
  Dismissing is allowed; closing an `alert` is allowed, because a run that had
  to ask could not get past one. Accepting a `confirm`, `prompt` or
  `beforeunload` carries `destructive` — critical, never grantable — because
  the page's own words are the only clue to what it commits to.

## Policy: pricing and consent

- **A child-frame effect happens on the frame's origin.** The resolver sets
  `frameUrl`/`frameOrigin` for a target outside the root frame; policy judges
  grants, grant offers and sign-in/payment paths against those, while
  `sourceUrl` stays the page the tab shows and history records.
- **Submission is priced where it happens, not from the target's shape.**
  `maySubmit` says a control sits on a submit path, which is true of every
  field in a single-input form; pricing it as critical made each character
  typed into a search box an ungrantable prompt and trained the user to
  approve without reading. The `submission` class the resolver attaches to a
  click on a submitter and to Enter in a field that submits on it is what
  costs an approval. Typing is a `form_mutation`.
- **Submission is `high`, and therefore grantable.** It was critical, and
  critical is never grantable, so an agent asked to post ten comments had to
  ask a human for the final click ten times with no way to say yes once — a
  prompt nobody can ever answer in advance is not read more carefully, it is
  read less. It is in `AGENT_GRANTABLE_EFFECTS` beside `activation` and
  `form_mutation`, so "always allow this kind of action on this origin for
  this run" covers it, and it still costs an approval by default. The floor
  is unmoved: `destructive`, `authentication`, `payment`, `sensitive_input`
  and `file_selection` stay critical or takeover, a grant never covers a step
  carrying one of them, and a submission riding along with one is priced by
  the one.
- **Routine-action consent is a preference each run mints grants from.**
  `AGENT_PERMISSION_MODE` (device-local, "allow on the starting site" by
  default) is read once per start; `allow_routine` makes the background create
  only activation and form-mutation grants (`AGENT_ROUTINE_GRANT_EFFECTS`,
  deliberately narrower than `AGENT_GRANTABLE_EFFECTS`) for the starting
  origin in that run, and `approve_each` keeps per-step review. A remembered
  preference is not a carried grant: changing it never widens a run already
  going, and a new run receives no previous run's grants. Submission,
  destruction, new origins and sensitive controls retain their own gates — a
  submission is widened only from an approval the user was shown, never in
  advance from a setting. It replaced a per-task checkbox that reset to
  checked on every panel mount while its label said "for this task".
- **An edit with no submission step says so, and says only that.**
  `noSubmitStep` is set on an edit whose target belongs to no form — an
  editing host, or a bare field in an application that saves on input — so the
  approval states that no submit will be asked about later rather than
  implying one. What it must not claim is that anything was stored: value
  verification compares the control and nothing else, and a standalone filter
  box with no submit step persists nothing, so the wording is that the change
  *may* already be stored. Evidence, not risk: the class stays
  `form_mutation`. It is read from the observation, which is why
  `formFingerprint` is reported for every control belonging to a form and not
  only for the ones that submit.
- **The egress rule is about data the run read, not words it wrote.**
  A destination the model composed carrying a page field's value is blocked
  as `private_data_egress`. A search box holds a field value like any other
  control, so a run that typed the user's own query and then followed the
  site's own search URL was killed for exfiltrating it — the one thing the
  task had asked for. `provenance.ts` answers authorship from the run's own
  words: the goal, the user's answers, and the text it typed or selected on
  its own durable receipts (never `replace_text.find`, which is a quotation
  of what the page already held). Every long span of the URL must be
  accounted for by those words, containment one way only, or the block
  stands; no authored words at all is no claim, and the rule stays as strict
  as it was. The destination raises are untouched, so a model-composed URL
  with a query is still `high` and the user still sees the whole URL. The
  honest limit: a value the run typed is its own, so a model that copies a
  field value into a box and then navigates with it is stopped by that
  approval rather than by this rule.

## Follow-up runs

- **A follow-up is a chat message.** A settled card offers Continue
  (completed, partial), Retry (failed, cancelled), Start over and Ask; each
  drafts a message in the chat composer that the user still sends, and the
  model decides whether the browser is needed again. A run it starts from
  there asks for approval like any other.
- **A card names its run; otherwise the background names the parent.**
  Continue and Retry draft the message with the card's run id beside it
  (`agentFollowUpRunId` on the turn, dropped if the user empties the box),
  and that run is the parent whatever ran since — an older card continuing
  the newest run would inherit the wrong record. Without one, `browser_task`
  takes `continue_previous_task: true` and nothing about what the previous
  run did; the parent is the newest run in the branch (`previousAgentRunId`),
  and the mode follows its status. `resolveAgentFollowUp` reads the parent's
  checkpoint and receipts
  and refuses (`follow_up_unavailable`) when the parent is gone, still live,
  in another chat, or unreadable: a follow-up that guessed what was done is
  the one that repeats it. A chain that committed more than
  `MAX_AGENT_PRIOR_EFFECTS` is refused too, never trimmed — the effect
  trimmed off is the one the next run could repeat. Start over carries nothing and is never refused.
- **A child plans and asks afresh.** It inherits the parent's handoff and the
  consequential effects the chain committed (`state.previousRun`) — never its
  grants, answers, requirements or origins. `parentRunId` is written on the
  run row on every path.
- **A committed consequential effect is never attempted twice unasked.**
  Submission, destruction, payment and download are recorded on each receipt
  as `consequential` (the classes), with the form's action, origin and path,
  for a submission or payment; `agentCommittedEffects` reads the steps whose
  last receipt is executed, verified or uncertain. Two matches, two answers:
  - *The same command on the same control* (role, tag, name, and page when
    both know it) is a repeat. The controller refuses it before policy is
    asked, so the user is never prompted to approve the second order, and
    hands it back to the model like any other refusal. Coarse on purpose: a
    false match costs a look again, a miss costs a second purchase.
  - *The same form sent by a different control* — Enter in a field after a
    click on its button, or a checkout's next step posting to the same
    address — may or may not be one. Policy prices it at least high, accepts
    no grant for it, offers none, and says in the approval that an earlier
    run already sent this form. Refusing it would stop a checkout at step
    two; allowing it on a grant would place a second order unasked.
  Receipts older than the flag count a critical change.
- **Inside one run, the same control twice is asked as a repeat.** The
  controller reads the run's own receipts through the same
  `agentCommittedEffects` and, when a consequential effect matches one this
  run already committed by the same-control rule, tells policy
  `repeatsCommittedEffect`. It is asked rather than refused — two rows of a
  list share a "Delete" label, and deleting both is an ordinary task — but
  priced like the prior-form case: at least high, no grant covering it, none
  offered, and the approval opens by saying this run already did it once.
  What it exists for is a page whose own confirmation was lost between the
  two clicks: the first press landed, and a fresh approval would have read as
  the first delete. If receipts cannot be read, policy asks without claiming
  a repeat occurred: the approval says the earlier effect is unknown, costs
  at least high risk and cannot use a grant.

## Verification, waiting and completion

- **Input delivered, effect observed and goal achieved are three answers, and
  a run owes all three.** The receipt's `inputDelivery` says the page received
  the events; the verifier's outcome says the control changed as the step
  intended; neither says the thing the user asked for is true. Clicking Save
  is an activation a verifier confirms — the button was pressed, the page
  changed — while the document is still saving, so `complete` used to let
  every run that pressed the right button report success.
  `judgeAgentCompletion` (`completion.ts`) is the third answer, and it asks
  for a quotation only where the gap between the second and the third is
  real. Whether it is real is a question about the **verification**, not
  about the outcome: `confirmed` is one word for two different findings, and
  the evidence kind says which. A verifier that compared the step's own
  intended result — `field`, `checked`, `arrangement`, `condition`
  (`RESULT_VERIFIED_EVIDENCE`) — has already answered the third question for
  the change it checked, and that check *is* the evidence: the run completes
  without quoting anything. Demanding a phrase on top of it asked for
  something a toggle cannot produce — selecting Blue in a dropdown and
  ticking a checkbox add no words to the page, so every quotation a model
  could offer was already there (`stale_evidence`), the control's own label
  (`self_evidence`) or not page text at all (`absent_evidence`) — and three
  live runs finished the task, were confirmed, and spent their whole budget
  being refused for work they had done. Every other kind is a reaction, not a
  result: `activation` is confirmed when the page changed in *any* observable
  way or the control merely took focus, `submission` when the form went,
  `navigation` when the tab arrived. A menu opening is an observable page
  change, so waiving the quotation for those let a run click an intermediate
  control and report the goal met — they owe one. So does a change that
  verified `ambiguous` (the effect landed and the page has not shown its
  consequence) and a run whose receipts could not be read; a change with no
  verification recorded is refused outright, because nothing checked it and
  no phrase completes that.
  Where a quotation is required it has to be in the observation the run
  decided on, read by the same matcher `wait` uses (`observed-text.ts`) so a
  run cannot complete on evidence its own wait would reject. A run that only
  read owes none — what it read is its answer.
  A planned page-changing command names the requirement id it advances, and
  that id is durable on the step receipt. This is the binding for result-verified
  state: planning happens before observation, so `Address` may legitimately
  lead to a `Billing Address` control, while label containment alone cannot
  distinguish that alias from the wrong control. The id may name any planned
  requirement: opening an accordion or applying a filter can change page state
  only to reveal information for a `read` requirement. A page-changing command
  in a planned run is refused before execution when the id is absent or unknown.
  Legacy receipts have no id and use the conservative full-label fallback;
  never restore reverse label containment.
  Changes are counted from the resolved effect's own classes and recorded
  durably on the receipt as `mutating`, because a worker restart keeps the
  receipts and loses everything else; navigation is not a change, or every
  research task would owe a saved-state indicator it never had.
  Presence is necessary and not sufficient. Nothing in the trusted layer can
  judge whether a phrase *demonstrates* the goal — that is the claim the
  model is making, and no deterministic rule checks it — but it can refuse
  evidence that was already true before the change and therefore cannot be
  evidence of it: the acted-on control's own label, compared exactly so a
  goal worded around a button's text is still answerable, and anything the
  page already said when the change was decided. That baseline is promoted
  against the status the step actually settled on — `isAppliedAgentStepStatus`
  is shared with the judge's own selection so the two cannot drift, because a
  baseline captured for an attempt that never landed would measure a later
  completion against a page already holding the previous change's result and
  refuse every honest quotation of it. It lives in the worker that made the
  change, so a restart loses it and the check is skipped rather than guessed
  at — an absent baseline is not proof the evidence is new, and after a
  restart the interrupted step is `uncertain` with no verification behind it,
  which the unverified-change rule refuses before evidence is reached at all.
  A step is appended once per lifecycle change, so the judge collapses
  receipts to the last one per step before selecting, the way history does: a
  superseded `executed` receipt for a step that went on to fail is an applied
  change with no verification, and would refuse every completion after it. Receipts that
  cannot be read are an unknown, never an empty history — reading them as
  "changed nothing" is the hole the gate exists to close. A refusal is a safe
  failure: nothing was attempted, so it is recorded as a rejected step and the
  run looks again, with the reason reaching the next decision through its own
  history. Looking again is the right answer once — the indicator may not
  have appeared yet — and the wrong one when the same refusal comes back
  unchanged, so a second consecutive refusal for the same reason pauses with
  a question instead (`MAX_CONSECUTIVE_REFUSED_COMPLETIONS`), and any
  confirmed step clears the count. A run that spends twenty observations
  re-claiming a finished task and then reports `budget_exhausted` has told
  the user nothing. `deciding -> observing` is a
  real edge in `AGENT_STATUS_PREDECESSORS` for that reason: every other exit
  from `deciding` runs through a step, and a declined decision touched
  nothing. `claimAgentRunPhase` filters `expected` by those predecessors
  before it reaches SQL, so a claim across an edge the table lacks matches no
  row and strands the run — the controller's test double enforces the same
  filter, because a double that only checked `expected` was more permissive
  than the database and hid exactly that.
- **Waiting is bounded looking, not sleeping.** `wait` names an application
  state — a saved indicator, a row that appears — and the verifier re-observes
  until the page shows it or the named timeout is spent, whichever comes
  first, capped at `AGENT_WAIT_MAX_POLLS` because every look is a full
  observation. The whole named window is covered — the look before the last
  waits out whatever remains, since six looks leave five gaps and spacing
  them evenly ended a thirty-second wait at twenty-five, sending the run off
  to re-plan work that was about to succeed. Sleeping the whole timeout and reading once was the worst of
  both: a save that landed in 300ms still cost thirty seconds, and one that
  landed a moment after the single read was reported absent.
- **An ordinary effect gets a settle window, not a sleep.** A page that
  answers a click over the network answers it a little after the click, and
  the verifier read once, immediately — so an effect that landed 1.2 seconds
  later verified `ambiguous` and paused the run as an unresolved effect three
  seconds after a step that had worked. Every DOM-mutation verifier is
  wrapped in `settling`, which re-reads only an `ambiguous` answer, at most
  `AGENT_SETTLE_MAX_POLLS` times across `AGENT_SETTLE_WINDOW_MS`, and returns
  the moment the effect is there. It shares `pollUntilSettled` with `wait`,
  because both ask the same question and a second copy would be a second
  place to get the spacing wrong. `confirmed` and `negative` are conclusions
  drawn from evidence the page already gave and are never re-read; the
  wrapper sits *inside* `withDelivery`, because interference, a misdirected
  plan and a held file chooser are facts about the input that looking at the
  page again cannot change. The `unresolved_effect` pause is unweakened — it
  is only given two seconds to stop being unknown.
- **A budget is sized for a real task, and the step ceiling is longer than
  one decision.** `MAX_AGENT_OBSERVATIONS` counts one observation per
  decision, so it is the run's step ceiling under an older name; the panel's
  progress bar is a step counter. `AGENT_STEP_ACTIVE_BUDGET_MS` must stay
  strictly greater than `AGENT_DECISION_TIMEOUT_MS` — it was sixty seconds
  while a decision was allowed a hundred and twenty, so a model answering
  inside the time it had been promised had its good step failed with "this
  Agent step exceeded its active time budget", which reads like a hang and is
  not. Both constants live in `budgets.ts` for that reason, and
  `budgets.test.ts` asserts the ordering. The run ceiling follows from the
  other two: fifty steps at live decision latency need the better part of
  half an hour, and what bounds a runaway run is the observation ceiling and
  the no-progress guard, not the clock.

## Screenshots

- **A screenshot is an observation's companion, never a record.** The
  controller pictures the tab (`AgentScreenshotPort`) only after the DOM
  observation is in hand and only for a model whose `vision` the model port
  resolved from the same evidence chain as tool calling; text-only models are
  offered no `click_point`/`zoom` and cost the page no capture. The picture
  carries the observation's snapshot identity and scroll, travels as the user
  message's image attachment, and is held for that decision and the resolution
  that follows — never persisted, logged, traced or shown. A capture that
  fails leaves the decision to the DOM; it never fails the run.
- **`auto` is the default, and it is a question about the step.** A capture
  costs an encode, a masking pass and — far the largest — an image prefill in
  the model's own window, and most steps decide from text and never look at
  it. `agentPictureWarranted` (`vision.ts`) takes one on an explicit `zoom`,
  on the first step of the run, after a step that did not confirm, on the
  first step on a **page the run has not seen** (compared against the last
  recorded step's source URL, so a query or fragment moving buys nothing), and
  on a page the DOM can barely describe — four controls or fewer with a
  document half again taller than its viewport. The new-page rule is what
  keeps recovery reachable: `zoom` and `click_point` are offered only where a
  screenshot exists, so a run that navigated to a canvas application and was
  refused a picture for having five buttons had no way left to ask to see it.
  `always` and `never` remain the user's to choose.
- **Nothing leaves unmasked.** `screenshot-capture.ts` asks the page for
  every region a picture must cover (`agent_sensitive_regions`): each sensitive
  control in the *whole composed tree* — never the bounded observation, which
  stops at its element budget — and every child frame, masked whole because a
  frame the run cannot read may hold a sign-in form and one it can read cannot
  be placed from the root. Regions are read at the observation's scroll
  position, then read again after the capture; any difference means the page
  moved under the picture and the step gets none. Masks are painted black in
  image pixels with a one-pixel margin and the long edge is bounded to
  `MAX_AGENT_SCREENSHOT_EDGE_PX`. The editor is the worker's `OffscreenCanvas`;
  without one there are no screenshots.
- **The fallback capture is the active tab's or nobody's.**
  `tabs.captureVisibleTab` pictures whichever tab is active in a window, so the
  debugger-less path (`visibleTabCaptureSource`) requires the controlled tab to
  be that tab immediately before and after the capture and returns nothing
  otherwise — a neighbouring tab stamped with this tab's identity would be
  masked for the wrong page.
- **Screenshots need their own acknowledgement, and the runtime enforces it.**
  `AGENT_REMOTE_SCREENSHOT_ACKNOWLEDGED` is separate from the observation
  acknowledgement. The panel shows the screenshot variant of the remote notice
  whenever pictures *may* travel — vision true or not yet determined — and
  `buildAgentController` refuses to picture a remote provider's run until the
  setting is set, whatever the panel showed at start. A local endpoint needs
  no acknowledgement; nothing leaves the device.
- **Coordinates convert through the picture's own geometry.** A screenshot
  records the CSS `region` it shows and its `scale` (image px per CSS px);
  `screenshot-geometry.ts` converts a model's image pixel to the root layout
  viewport point and back, which is how device scale, browser zoom, pinch zoom
  (`cssVisualViewport`) and a `zoom` crop all reduce to two numbers. `zoom` is
  read-only inspection: the next capture is a clip magnified to the zoom and
  edge caps, converted by the capture port from the geometry it remembered in
  memory — a restart forgets it and captures the whole viewport again.
- **A visual click is a click on the control under the point.** `click_point`
  resolves by asking the page what lies under the converted CSS point
  (`agent_hit_test`): the nearest listed control that contains the hit, else
  the hit element newly referenced into the live snapshot and observed like
  any other. Every click rule then applies — sensitive input, links,
  submitters, checkboxes — and only "not an activatable control" is waived,
  because a canvas is what a point exists to reach. A point inside a child
  frame is refused; the frame's own refs name its controls. A stale picture
  cannot authorize a click: the screenshot must carry the command's snapshot
  and generation and the observation's scroll, and the executor re-hit-tests
  the point before anything is sent, refusing a control that moved.

  What a visual click does **not** answer to is our own reachability
  reconstruction. `elementFromPoint` is the browser saying what a pointer at
  that coordinate lands on; `visible` is `resolveVisibility` rebuilding the
  same fact from client rects, the viewport and every ancestor's overflow.
  When they disagree the reconstruction is wrong, so `hidden_target` is waived
  alongside `not_clickable`, and occlusion needs no waiver because a hit test
  returns the topmost element. Everything about what the click would *do* —
  sensitive fields, links, submitters, checkboxes, a disabled control — still
  governs. Overruling the browser here refused four different points across
  ChatGPT's composer as "not visible" until the run's budget was gone.

  The waiver reaches execution too. `assertUnchangedMutationTarget` re-read
  `visible` for every command, so a visual click was refused one layer later
  by exactly the reconstruction resolution had just waived: a run asked to
  open a video spent seventeen of its steps having approved clicks on a
  thumbnail refused as `target_changed`, and never touched the page. The
  executor re-hit-tests the point before it sends anything, so the browser
  keeps the last word; everything about what the click would *do* is still
  compared, and a ref click still refuses a control that left the page.
- Disclosure says whether pictures travel: `AgentProviderDisclosure.screenshots`
  is resolved from model vision, memoized per model, shown as unknown when it
  could not be determined, and switches the remote-provider notice to the
  variant that names screenshots.

## Supervision receipts and the work log

- **The work log shows one row per step.** A step is appended once per
  lifecycle change, so rendering every receipt showed a single click four
  times over as "Planned", "Approved", "Running" and "Review". History and the
  completion judge collapse receipts to the latest per step for the same
  reason; the log is the one place a person reads them.
- **Every bound that has to agree with the step budget reads it.** Three
  literals were written when the ceiling was twenty-five and none moved with
  it: the snapshot's step cap, the row bound in `agent-runs.ts`, and the
  docs. The row bound was the worst of them — `appendAgentStep` threw at step
  26, so the raise to fifty bought nothing and the failure read "Agent run
  exceeds its 25-step limit", which is a persistence error wearing a budget's
  words. `MAX_AGENT_STEPS` now sits above `MAX_AGENT_OBSERVATIONS` rather than
  on it, because the run must end by running out of steps, with the reason the
  panel can explain, never because an INSERT refused.
- **The snapshot carries one receipt per step, and its bound is the budget.**
  `latestReceiptPerStep` collapses at the panel port, so the array is bounded
  by the step ceiling itself. It was every receipt against a flat cap of 125 —
  twenty-five steps at up to five receipts each — and that stopped being true
  the moment the ceiling moved to fifty: a long run overflowed the array, the
  panel refused the whole message as `unreadable_update`, and the supervision
  surface went dead at exactly the point in a run where there was most to
  supervise. A literal that has to agree with a budget will eventually not,
  so the schema reads `MAX_AGENT_OBSERVATIONS` rather than a number.
- **A row says what was acted on and why.** The step's `target.name` and the
  model's own `finding` were both durable and neither was rendered, so a log
  of twenty steps read as twenty repetitions of "Click control" — the run's
  account of its own work existed and the supervisor could not see it. The
  name travels beside the label rather than inside it: the label is one
  translated sentence, and a name is page text that has to read as page text.
  The goal is shown for the duration of the run too, because the box it was
  typed into is the surface the running panel replaces.
- **Vision unknown is not vision absent.** `resolveAgentProviderDisclosure`
  passes compatibility's `vision` through instead of comparing it to `true`:
  the field is stated only when there is evidence either way, and reading
  `undefined` as `false` told the user "Not used with a text-only model" about
  a model whose own catalog reports vision. The panel has a state for not
  knowing, and that is what an undetermined capability gets.
- **A refusal crosses the control port as a code.**
  `effect-rejection.ts` holds the whole vocabulary and both halves of it: the
  sentence each reason is raised with, and the classifier that reads it back.
  The document that refuses is untrusted, so nothing it composes may travel —
  an unrecognised message is `unspecified` rather than forwarded. The port
  used to carry no reason at all, so a covered control, a replaced target and
  a changed value all reached the run as the same bare error and were
  recorded as "Target changed"; two live runs died that way with nothing in
  the record to say which had happened. A refused identity check also names
  the field that moved, which is this build's own vocabulary and never a
  value read from the page — and the name travels with the code, as
  `rejectionField` against a closed list. Only the code crossed for a while,
  so seventeen refusals of one click all read as the same sentence with
  nothing to say which of fifteen fields had moved, and diagnosing it meant
  guessing from the page rather than reading the receipt. A name outside the
  list is dropped rather than forwarded, the same rule the codes follow.

## Recovery evidence

- **A real terminated worker is the only proof of recovery.**
  `pnpm verify:sw-agent-recovery` leaves a run durably `executing` with its
  step open, kills the worker through DevTools while the extension page and
  the offscreen SQLite owner keep running, and requires the replacement
  worker's own startup recovery to settle it: the step `uncertain`, the run
  `paused` for an unresolved effect, and no second step — a second step would
  mean the effect was reissued. The unit smoke test proves the SQL settles a
  run already in that state and cannot prove a terminated worker reaches it.
  Seeding walks the real state machine (a run may only be created
  `submitted`, and entering `executing` copies the planned receipt into an
  execution claim), in a loop, because a worker booting mid-seed runs the very
  recovery being measured and pauses the run out from under it.

## Read-only session tools and capture

- Read-only helpers: `src/lib/browser-sessions.ts`. Model tools: `src/lib/tools/internal/browser-session-tools.ts`.
- `sessions` is an optional permission. Always check browser support **and** the live permission before reading recently-closed or synced-device sessions.
- Session URLs must pass the same unreadable/never-read filters as other browser tools.
- `restore_session` is medium risk, so the tool loop asks before its first use in a chat; keep it behind that approval.
- `tabCapture` + `offscreen` is a Chromium 116+ prototype. Any capture flow must start from a user gesture, preserve tab audio, show persistent recording state and a Stop control, stop on permission revoke, and keep data ephemeral until explicitly saved.


## Starting a run from chat

- **`browser_task` is a chat tool that delegates, never a set of controls.**
  `browser_task(goal, tab_id?, continue_previous_task?)` sits beside the other
  internal tools and hands the whole task to the supervised controller, so
  planning, the affordance layer, per-step approvals and the completion judge
  run exactly as for any run. The chat model never gets click or type tools.
  The tool describes itself in `src/lib/tools/internal/`; the runner is the
  agent's (`agent-browser-task.ts`), installed by the composition, so a build
  without the agent — Firefox — offers no tool. Its result is the run's
  handoff, fenced as untrusted page data exactly as a later turn receives it.
- **The start is asked about once per chat and site, and always when it
  could be carrying page text.** The tool is `medium` risk with an
  origin-scoped grant resolver, so the tool loop's own approval asks before
  the first run on a site in a chat. `confirmation` forces the prompt,
  whatever grant exists, when the turn's context carried something read off a
  page (an attached tab or file, retrieved documents, a previous run's record:
  `pageContentInContext`), when a tool result advanced `taintGeneration`,
  when the model named another tab, when the model's tool calling is only the
  user's override, and when a remote provider's notice has not been
  acknowledged. The prompt shows the goal as plain text and the notices as
  keys; approving it is the acknowledgement those notices ask for.
- **A goal the model wrote after reading a page is not the user's words.**
  The run records `goalAuthor: "model_after_page"`, and `agentAuthoredText`
  leaves that goal out, so the egress rule cannot be laundered through a task
  a page talked the model into writing.
- **The run reports into the turn's own row.** `attachRunToMessage` claims
  the assistant row the turn is streaming into and inserts the run in one
  commit; there is no request row of its own (`requestMessageId` stays
  empty). The settle writes the handoff and leaves `done` and `content` to
  the turn, and startup reconciliation only closes rows of runs that have a
  request row. One run per row: a tool call replayed after a worker restart
  finds the run it already started (`delegate` looks it up by row) and waits
  on it again.
- **The turn waits, bounded, and stops the run only when it was stopped.**
  `awaitSettled` ends a wait and nothing else. A stop that lands while the
  run is being admitted is checked for, not only listened for: it fired
  before the wait existed, and the run would otherwise keep driving the tab. The runner waits up to
  forty-five minutes and then tells the model the run continues on its card;
  a turn the user stopped stops its run, because nobody is left to read the
  answer. Admission is still one unresolved run at a time across chats — a
  second start is refused with a sentence the model relays.
- **The tab is the panel's.** The side panel reads its own window's active
  tab at send time and the turn carries it as `browserTabId`; a worker has no
  window, and `lastFocusedWindow` is only the fallback for a turn that did
  not carry one.
- **Hosted runtimes behind olc wait as long as the run does.** A chat turn
  parked on `browser_task` would otherwise be reaped by the run's own forced
  decisions, or time out at the bridge's old five minutes; see
  `packages/olc/AGENTS.md`. Nothing here knows olc exists.

## Panel supervision surface

- **Chat is the only workspace, and there is no mode.** A run is started by
  the chat model calling `browser_task` (see [Starting a run from
  chat](#starting-a-run-from-chat)), drawn as a card above that turn's own
  answer, and followed up by sending another message. The shell lends chat the
  card renderer and a door back to the composer, so chat imports none of the
  Agent. The card of the run the panel's port holds carries its approval,
  handover, question and controls, each with its own control; the composer
  never carries a decision. The port lives as long as the panel does, so
  chatting while a run works does not pause it — only closing the last panel
  does. The Chat/Act toggle and its preflight are gone: a toggle whose silent
  revert to Chat hid every refused start was the wrong place for the decision,
  and the model reading the request is the right one once runs target hosted
  models.
- **A run waiting on the user marks the toolbar icon.** `registerAgentAttentionBadge`
  shows `!` while the latest run is awaiting approval, awaiting a handover,
  or paused — including the pause taken when the last panel closed — and
  clears it when the run moves on. It says only that; nothing a page wrote.

- **The debugging banner is named before a run, not after it appears.** The
  start prompt says that Chromium shows its own banner while a run works; a
  banner with nothing beside it is what sends someone to ask a developer.
  `AgentBrowserDisclosure` still travels on every panel snapshot, read from
  the session manager rather than guessed from a user agent.
- **A failure leads with the recovery.** `AgentError.message` is written in
  English for whoever reads a receipt and says what happened; the run's card
  shows `agent.failure.<code>`, in the reader's language, and the message
  never crosses the card's RPC — it can name a provider URL. The words the run
  used survive in the durable record and the debug report, which is where a
  bug report reads them. A code with no key falls back to the `unknown` advice
  rather than to nothing.
  A failure the layer below already named keeps its own name: `AgentError`
  carries an optional `messageKey` and `agentProviderFailure` reads the
  provider's `messageKey`, `userMessage` and `retryable` structurally (never
  by instance — the runtime knows nothing of the host's error classes), so a
  wedged local proxy answering 503 stops surfacing as "the model could not be
  reached, check the provider is running" while the provider is healthy. The
  panel prefers that key over `agent.failure.<code>`; the code still says
  which part of the run stopped.
- **A refused effect records why it was refused.** The executor's
  `AgentEffectNotAppliedError` message is one of the closed vocabulary in
  `src/lib/browser-agent/effect-rejection.ts` — composed by this build, never
  by the page — so the controller records it as the step's verification
  summary instead of one fixed sentence. Flattening it threw the cause away a
  line before it became useful and left live failures undiagnosable; the
  fixed wording remains the fallback when the refusal carries no message.
- **Supervision needs the action and the ceiling.** The status is the
  machine's word for it, so the panel also names the step in flight — the
  same label the work log uses, so the two cannot disagree — shows progress
  against the observation budget that will stop the run, and counts every tab
  the run drives once it has adopted more than the one it started on.
- **The runtime names sentences; the panel says them.** An approval, a
  takeover and a question the run itself asks carry `display` — i18n keys and
  their values (`AgentDisplayText`) — beside the English `action`,
  `consequence`, `instruction` or `text`, which stays for receipts, tests and
  records written before `display` existed. The panel renders `display` when
  it is there and the flattened English otherwise; a value named `…Key` is a
  key translated before it is interpolated (a dialog's kind). Commands are
  labelled once, by `agentCommandDisplay` in the runtime, for the log, the
  line above it and the approval alike, and the switch is exhaustive, so a
  command added without a label fails typecheck instead of showing
  `agent.action.fill_form`. `agent-i18n.test.ts` looks up every key the
  runtime can emit.
- **The card's controls never scroll away.** Pause, Resume and Stop sit under
  the progress bar, above the attention area and the bounded log; they used
  to be the last row of that log, out of sight on a long run. The log follows
  its newest row unless the reader has scrolled up. Every pause reason says
  why on the card — a closed panel included — and a command the worker never
  received, or refused, is shown on the run rather than in a composer that is
  back in Chat by then.
- **An approval arriving is brought into view and announced, never
  pre-answered.** It scrolls into view and focus moves to the card, not to
  Allow, so an Enter meant for something else cannot approve an effect; focus
  does not move at all while the user is typing.
- Panel copy is i18n like everything else: every key exists in all nine
  locales, and `pnpm generate:resources` runs after a locale edit.
- **A run's record comes out as text, in a dev build.** From the side panel's
  own DevTools console, or the background worker's:
  `await __agentReport()` for the run that ran last,
  `await __agentReport("run-id")` for a particular one, `copy(await
  __agentReport())` to the clipboard. It returns the durable record — every
  step's command and its fields, the verification outcome and summary, the
  failure's code — because a screenshot of the work log has statuses and none
  of those, and diagnosing a run from pictures loses exactly what says where
  it went wrong. `globalThis.__OLLAMA_CLIENT_AGENT_TRACE__ = true` is the
  other half: structural phase lines for the rest of the worker lifetime, and
  that one is the worker's console only. The panel carries the dump because
  the worker's console is behind chrome://extensions, is not the console the
  panel is open in, and loses the binding whenever the worker sleeps.
  The dump is compile-time absent from store builds (`__AGENT_DEBUG_REPORT__`)
  because the record quotes page text. `pnpm dev` carries it; a production
  build does not, so testing against one means `pnpm build:debug` — the same
  output directory, the same production bundle, with the dump kept. Only
  `WXT_AGENT_DEBUG=1` turns it on, so a release build cannot acquire it by
  forgetting a flag.
- **A refusal's coaching stays with the model.** Completion and grounding
  feedback is kept in the durable receipt for recovery and debugging, but a
  rejected work-log row uses translated review copy and a question uses its
  translated prompt without interpolating that feedback. A verifier's advice
  about quotations and internal evidence is not a question for the user.
- **An approval names its exact row and risk.** A control in a visible list or
  table row carries a bounded `rowContext` from rendered text, so identical
  Delete buttons can be distinguished in the approval evidence. The panel
  labels the policy's risk in the reader's language; it does not recompute it.
- **A released native dialog leaves a receipt.** Before the session manager
  detaches and dismisses a held dialog, the run service writes an uncertain,
  non-mutating release receipt. It appends a verified receipt under the same
  step id after detach succeeds. If that final write fails, durable history
  keeps the uncertain marker and cleanup retries the final write before the
  next attachment. A failed retry leaves that marker uncertain and is
  quarantined, so a later session's dialog gets its own receipt even when its
  dialog id repeats. If storage rejects the initial intent, cleanup still
  detaches so a closed panel cannot leave the page blocked by a dialog; the
  failure is logged.

## Measured behaviour and benchmarks

The two benchmark projects write their own counts to
`artifacts/e2e/benchmark/`; that output is the record. No table in the
repository restates it, because a copied number goes stale silently while the
run that produced it can always be repeated.

- **The benchmark records, the gates assert.** `chromium-agent-benchmark` and
  `chromium-agent-benchmark-dom` run the same thirty frozen tasks with and
  without the `debugger` permission — the second is the browser Firefox gives
  us — and write counts, never rates: a handful of attempts cannot support a
  percentage. Tasks are declared `gated: false`, which is what makes a stalled
  run a recorded row instead of a failed test; the run that did not finish is
  the most interesting result and throwing would leave it out.
- **A task scores itself independently of the run.** Every task carries a
  `succeeded` predicate: for an effect it reads the page, and for a reading
  task it requires the page to state a fact *and* the answer to carry it.
  False completion cannot be counted any other way, since the thing being
  measured is precisely the run's verdict being wrong — and
  `Boolean(run.result)` is not a scorer at all, because `result` is the
  model's own summary and exists whenever a completion was accepted. Its counterpart — goal met, never claimed —
  is counted too, against the status the task *declared*, because some tasks
  are meant to pause and scoring those as missed would call the right answer a
  failure.
- **A live pass runs the whole suite.** The critical suite's hosted matrix
  deliberately runs only a couple of its tasks, and applying that skip to the
  benchmark left a hosted run recording nothing and writing no report — the
  opposite of the point. The skip applies to gated scenarios only.
- **CI runs the fixture pass.** Not as a threshold gate, which it is not, but
  because it asserts, and the completion-evidence rule broke two of its
  scenarios while nothing was running it.

## Task-completion contracts

- Clarifications carry their question and answer into `agent-model-port.ts`.
  A user correction applies only to the exact user-paused state (`pausedAt`);
  it cannot resume an unresolved side effect or answer an approval.
- `MAX_AGENT_TEXT_CHARS` is the shared editing value ceiling across commands,
  observations and the control port. `valueTruncated` refuses editing and
  prevents verification from accepting a prefix as the whole result. A value
  exactly at the ceiling is editable when complete. Never truncate an expected
  value merely to make verification succeed.
- Control lookup searches both the ARIA name and a separate placeholder hint,
  including an empty editor's child-paragraph placeholder. Never rename an
  editor from its draft text. Invalid-decision feedback names schema-owned
  fields to repair, without echoing rejected values or Zod messages.
- `extract_text` offsets are reconstructed from the durable command and sent
  to the selected frame through its authorized observation session. The
  extraction page carries a continuation offset, and projection adjusts it
  when it further shortens the page. No page query may bypass frame access.
- `scroll` with `container: true` names a scrollable ref; its own scroll
  coordinates, joined by verification identity, prove movement. Ordinary ref
  scrolling retains `scrollIntoView` behavior.
- A native dialog can block input acknowledgment. The executor stops waiting
  on the renderer using debugger state, does not replay input, and verifies
  that the same dialog is held. A held dialog skips screenshot capture,
  because the renderer cannot answer it. The following dialog decision keeps its own
  approval. Browser fixtures must register a passive Playwright dialog
  listener, otherwise Playwright dismisses it before the extension can answer.
- Completion retries read evidence only. Missing evidence is never accepted
  because a timeout elapsed. Repeated or alternating decisions pause for a
  correction; user/question pauses suspend active-time accounting. A supplied
  completion quote is checked even for a run that only read or scrolled.
- A confirmed `fill_form` receipt records each checked field's bounded name,
  never its value or a reversible digest of it. The judge may use one batch to
  satisfy several field requirements only while the current observation
  shows the named controls holding the required values. A no-submit
  requirement reads a complete run history of applied consequential receipts;
  an unreadable receipt or any submission prevents it from being claimed as met.
- Planning is optional only at the host boundary. A host with no planning port
  retains the legacy completion path, but once the port exists an exhausted or
  empty plan fails the run before its first observation. Planning failure must
  never buy the weaker pre-requirements judge.
- `agent-useful-workflows.spec.ts` exercises composer lookup, long editing, pane scrolling,
  paginated extraction, clarification, delayed save and native confirmation.
  Its hosted flag also runs these tasks against a real provider. Scripted
  results establish execution coverage, not live-model reliability. Set
  `AGENT_HOSTED_WIRE=ollama` for native Ollama; the default is OpenAI-compatible.
- The panel debug report uses its existing authenticated supervision port.
  Features never import background repositories. Store checks scan every JS
  bundle for debug helpers regardless of the caller's environment flags.
