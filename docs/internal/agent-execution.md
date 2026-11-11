# Browser agent: execution

Detailed implementation contracts. Start with [AGENT_INTERNALS.md](../../AGENT_INTERNALS.md) and read only the sections relevant to the change. Repair history explains existing behavior; it is not evidence of live-model reliability.

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
- **The run works in the background; the user keeps their own tab.** Nothing
  the agent does brings a tab to the front or focuses a window. A start
  address opens beside the user's tab (`active: false`), `open_tab` does the
  same, and `switch_tab` moves the run — its receipt names the tab it now
  drives — without activating anything; its verification asks whether that
  tab still holds the destination, never whether it is the active one. What
  makes a background tab drivable is `Emulation.setFocusEmulationEnabled`,
  sent on attach: a hidden Chromium tab otherwise runs timers about once a
  second and no animation frames, which stalls the page's own scripts and
  every settle the run waits on. Measured in a real Chromium with the tab
  behind another: without it, 3 timer ticks in 3s and no frames; with it,
  full-rate timers, running frames, `visibilityState: "visible"`.
  It is page-wide: a cross-origin iframe in its own process, measured the
  same way, went from 3 ticks and no frames to full rate from the one call
  on the page, so child sessions need none. A start tab `browser_task`
  opened joins the run's tab group once the run has an id — opened in the
  background, the group is what says which tab the agent is in; the user's
  own tab is never grouped, and a replay that hands back a run on another
  tab leaves the fresh one ungrouped. A start tab no run ends up driving —
  the service refused the start, the turn stopped, a replay returned another
  tab's run, or admission refused the page — is closed; a start that failed
  unexpectedly keeps it, since a run may already hold it. The details card's "Controlled tab" row is a
  button that brings the tab and its window forward — on the user's click,
  the one way a run's tab reaches the front, for a handover or a page to
  review. A settled card offers the same through `AgentRunCard.tabId`, which
  the background sets only while the tab is still open on one of the run's
  allowed origins — tab ids are reused after a browser restart — and
  `showAgentTab` checks the tab against `tabOrigins` again at the click,
  because a settled card stops refreshing. The run's tab also keeps playing media and
  animations after the user leaves it, since the page believes it is in
  front. Screenshots and debugger input reach a hidden tab either way. Detaching
  ends the emulation. The debugger banner is Chrome's and shows on every tab
  while any tab is attached; nothing here can hide it.
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
- **A tab the page opens because the run acted is the run's.** The effect
  port watches `tabs.onCreated` from the moment an element action touches
  the page until the controller calls `AgentEffectPort.settled` — after the
  last look at the effect, never between two — and reports tabs whose opener is
  the controlled tab on the receipt (`openedTabIds`). The verifier credits a
  click that did nothing but open one — a `target="_blank"` link left its own
  page unchanged and paused as an unresolved effect — and the confirmed claim
  adds them to the scope without moving the run. Switching to one asks
  nothing; switching to any other tab still does.
- **Agent tabs are grouped when `tabGroups` is granted.** A tab the run opens,
  or the page opens for it, joins one group per run labelled with the
  extension's short name (`agent-tab-group.ts`). Calls for a run are chained,
  so two tabs opened together share one group, and a later run from the same
  tab gets its own. The start tab is never moved into it. The permission
  stays optional; without it — or if the permission query fails — tabs open
  ungrouped.
## Input delivery

- **Native input is chosen before the action and never swapped after it.**
  `chooseAgentInputBackend` (`native-input.ts`) decides `cdp` or `dom` from the
  command, the resolved target and whether the run holds the tab's debugger
  and can place the target's frame. Form submission,
  Enter-on-a-submitting-field and a newline typed into one stay on the
  guarded DOM paths whatever is attached — those paths exist so page handlers
  cannot redirect an approved destination, and a native click or Enter would
  hand it back to the page. Links follow the rule below. A chord on a
  character the key table cannot press has no native form and goes to the DOM
  path too. Once a native step has been sent, a failure is an unresolved effect; it is not
  completed through the content script. Only a plan the debugger refused from
  its first step is a clean `AgentEffectNotAppliedError`.
- **A plain link is pressed, and the page it lands on is checked.** A link
  whose only effect is navigation and whose label does not read as committing
  or saving (`agentLinkTakesNativeClick`) gets a real CDP click where the
  debugger is attached, so a single-page app's router sees its own click —
  following the address bypassed it, and `spa_link` never loaded its view.
  `verifyNativeLink` tells three outcomes apart by the document the tab holds:
  the same document means the page handled the press, credited only on a
  changed page and, when the router moved the address, only on the link's
  own; a new document must be the link's own address, and anything else
  committed pauses as unresolved; one opened tab is held to that same rule,
  and several are unresolved. A
  link labelled "Place order", and every link without a debugger, is still
  followed by address, its handler never run.
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
  OS. Native `<select>` stays synthetic: a native option popup
  cannot be driven. `check` and `uncheck` press the box natively when it was
  observed in the opposite state — frameworks that own a box's state listen
  for the click, and a stated value left a controlled checkbox unticked on
  the server's record — and otherwise run on the DOM path, which now clicks
  too and leaves a box already in the asked-for state alone. That click,
  alone, inside `fill_form` or pressed natively, refuses any `submit` event
  it sets off: a box is approved as a field, and a handler calling
  `requestSubmit()` must not turn it into a submission. A native press holds
  the guard until it settles, five seconds at most. `form.submit()` fires no
  event and a `fetch` is the page's own, so neither is caught; the verifier
  reads what they leave. A value set by
  script finishes with `change` and `blur`, except in a field Enter would
  submit or one whose suggestions the next step may use. Text typed through
  the debugger is finished the same way on settle, after the input record is
  taken: focus leaves the field and the browser fires its own trusted
  `change`, so nothing synthetic is sent on that path.
- Firefox has no debugger: `double_click` and `hover` degrade to synthetic
  events there, the receipt says `backend: "dom"`, and the hover verifier
  then needs page evidence, since no delivery record exists.
## Forms, editors and drags

- **What a pointer or key can reach without a native control.** The
  observation lists a `<details>` summary with `expanded` set from whether its
  details are open, a label standing in for a hidden checkbox or radio with
  that control's state as `ariaChecked`, and the body while an overlay is open
  and nothing else has focus. Clicks reach summaries, those labels and `div`
  checkboxes and radios, verified by the state read back. Escape, Tab,
  Shift+Tab and the arrows may go to a focused body (`body_key` refuses the
  rest); Enter never does. A native plan for a body key samples no point.
- **A date, time, range or colour input is set whole.** `clear_and_type` with
  the value in the input's own format runs on the DOM path and is read back,
  because typed keys land in one segment of the browser's picker; `type` on
  one is refused as `use_clear_and_type`. A browser that rejects the value
  empties the field, and the verifier says so.
- **A multiple select gains the option named.** `select` on one adds that
  option rather than clearing the others, and is verified from the option
  list, whose chosen entries carry `selected`.

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
