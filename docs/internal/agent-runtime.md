# Browser agent: runtime

Detailed implementation contracts. Start with [AGENT_INTERNALS.md](../../AGENT_INTERNALS.md) and read only the sections relevant to the change. Repair history explains existing behavior; it is not evidence of live-model reliability.

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
    could never accumulate. It was then cleared on
    `agentEffectChangesPage(effect)` instead, which is the class a step
    *intended*: every click reset it, so a run alternating "open Details" and
    "back" for twenty-one steps, or clicking one canvas point eighteen times,
    never accumulated either. No step clears it now. A step that moved the
    run on already reads as progress, because the next observation hashes
    differently.
  - A changed page is not always a new one. Each point also carries
    `changeSignature` — a hash of the visible text the step added and
    removed — and the same decision making the same change counts as a
    repeat even though no two observations hash alike. That is the shape of
    an accumulating effect (a status line appended per click); a counter
    stepping 1 → 2 → 3 changes differently each time and stays progress.
  - `classifyNoProgress` took a `verificationOutcome` input that reset the
    count on `confirmed`. Nothing ever passed it, and wiring it as written
    would have made the loop unkillable. It is gone; do not reintroduce it.
  - A decision is compared by the control it named, not its ref
    (`agentDecisionFingerprint`): refs are positional, so a list that gained
    a row renumbered the same button and the third click on it read as new.
  - The guard compares the last `MAX_AGENT_PROGRESS_POINTS` (twelve) points.
    At six, one lap of a click → read → Back cycle over three pages filled
    the window and pushed the first click out before it came round again.
  - A `wait` keeps the count it found, except a wait on a page whose hash has
    not moved since the previous wait: nothing it could hold for has
    happened. Waits for a description of the page ("the results appear")
    were free and ran seventeen times. The verifier also says when the page
    never changed while it watched, so the model hears that waiting again
    cannot help.
- **The stall counters are durable.** No-progress points (hashes only),
  refused commands, refused completions, malformed answers and failed plan
  amendments ride in `AgentRunState.stall`, written with every claim and
  transition that moves them and read back once per run per worker. A worker
  restart used to hand a looping run a fresh budget for each. A reset —
  steering, an answer, a resolved effect — marks the run restored so the
  checkpoint cannot undo it. The refused-command count resets where a command
  is carried out, not where it resolves: the refusals after resolution
  (missing requirement, repeat, limit, wrong row) used to find it zeroed.
- **A failed plan amendment backs off.** It is asked again on the next
  observation, then after two, four and at most eight; a newer answer from the
  user is asked about at once. Each amendment can spend several provider
  attempts, and a planner that is down stays down longer than a step.
- **A pixel command without a picture costs a retry, not the run's budget.**
  The decision tool's schema is the same on every step so the provider's
  prompt cache holds, which means it offers `click_point` and `zoom` on steps
  that carry no screenshot. Answering with one is refused with feedback and
  retried within the decision's own bound, uncharged to the run's
  malformed-answer budget.
- **A command the page refuses is asked again, then handed on, never made
  fatal at the parser.** `assertGroundedDecision` refuses an unlisted,
  hidden or disabled target so a retry can fix it for free, uncharged to
  the malformed budget. Once the decision's retries are spent the port
  returns that decision instead of failing, and the resolver refuses it as
  the rejected step described next. Failing there ended a run on a page that
  listed no controls after three of its ninety-eight steps; on such a page
  the feedback now says there are no controls and points to `extract_text`,
  `back` or `navigate`.
- **The model sees every page the run has been on.** History keeps twelve
  steps, so `buildAgentVisitedPages` adds a bounded `visited` list (origin and
  path, arrivals, steps) read from all receipts. Without it a long run forgot
  the pages it had read and opened them again.
- **A refused command is told to the model, not made fatal.** The resolver
  refusing to ground a command means nothing was attempted, so the run has
  lost nothing: it records a rejected step carrying the affordance layer's own
  sentence — assembled from templates and the model's ref, never from page
  text — and looks again, exactly as a declined completion does. Three
  consecutive refusals start a recovery strategy (below), and a question only
  once the strategies are spent; the older `command_refused` error remains readable for saved runs. Failing on the first
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
- **Read-tagged button activations get a retention reminder.** A Next button
  can replace the current page without exposing a link destination. Before a
  non-link click, point click or key activation tagged to a read requirement,
  the controller reminds once per page and requirement if no source quote is
  offered and no usable fact for that read is retained from the target frame's
  current document. The model may attach quotations or retry if nothing
  relevant is present; quotations still pass the usual grounding checks. This
  does not prove page coverage or semantic satisfaction, grant consent, or
  permit an effect to be replayed after uncertain execution.
- **The page a confirmed step reached gets the same reminder when left.** If
  the latest confirmed page-changing receipt (activation, navigation or
  submission) is tagged to a requirement and moved the tab to the current
  document, any leave or button/key activation from that document is
  refused once per page and requirement until a quote for that requirement
  rides on the step or is already retained from this document. This covers a
  change-tagged Submit on the last page of a read-tagged walk, and the result
  page of a confirmed commit. Unsettled steps, untagged moves, same-document
  activations and field-checked changes (their receipts prove them) get no
  reminder. The refusal runs before policy and execution, the second attempt
  passes, and the feedback forbids repeating the committed step.
- **Only quotes that will be kept count as retained.** Each guard on leaving
  judges the attached quotes exactly as they are kept once the step runs
  (`agentSourceQuoteRetention`). A quote that repeats a value the run entered
  or a field holds, or is not one span of the page's text, counts as nothing:
  the step is refused once more per page and requirement with the reason, so
  the model can quote the page's own words (its heading and labels) instead.
  Measured live: page one of an application was quoted with its select's
  options while the select held the run's "Blue"; the quote was dropped, Next
  went through, and page one ended with no evidence. A later attempt passes
  either way; the guard never weakens the run-entered-value rule.
- **Quotes on a read-tagged command are offered for that read.** A quote
  without its own `requirementId` on a command whose `requirementId` names a
  read is bound to that read (`agentBindReadQuotes`); one on a change-tagged
  command stays unbound. The leave guards counted unbound facts as kept while
  progress and coverage did not, and a live run reported a three-page review
  unmet with every page quoted. Binding says which outcome a quote was offered
  for; it is still only provenance for review.

### Bounded recovery

The no-progress guard, three refused commands and a stale snapshot used to end
in a question or a failure on the first trigger. Each now spends a strategy
first (`recovery.ts`), and only an exhausted budget reaches the user.

- **The budget is durable and never refills.** `AgentRunState.recovery`
  carries `attempts` (capped by `MAX_AGENT_RECOVERY_ATTEMPTS`) and the open
  episode: trigger, current strategy, strategies tried, and the last verified
  history step. It is written in the same claim that sends the run back to
  observing, so a worker restart reads the spent count back. The controller's
  progress and refusal counters were memory-only then; what a restart cannot
  do is refund an attempt. Terminal compaction keeps `attempts` and drops the
  episode. The progress and refusal counters are durable too now; see above.
- **A strategy is guidance or a fresh read, never an action.**
  `fresh_observation`, `targeted_read`, `wait_for_condition`,
  `request_vision`, `alternate_route` and `revise_approach` reach the model as
  the `recovery` field with a fixed template. Every command a recovery leads to
  goes through the same resolver, policy, persistence, executor and verifier.
  `request_vision` is offered only when the run can picture the page, and it
  forces a capture under the `auto` vision policy.
- **The repeat that triggered it is not carried out.** The guard's memory is
  kept across strategies, so a model that ignores the new strategy and repeats
  itself costs the next strategy at once, not three more repeats. A `wait`
  keeps the count it found and never triggers recovery. Only a real repeat
  does.
- **An episode closes on a verified page-changing step, a correction or an
  answer**, never on a verified read: one look would otherwise end every
  episode. Its tried list carries across triggers while it is open.
- **The task is not the run's to revise.** Recovery never writes
  requirements, constraints or the plan. `revise_approach` says so in its
  template, and the system prompt repeats it.
- **Effects settle three ways, not two.** `agentEffectSettlement` reads
  `verified` as `confirmed`; `planned`, `rejected` and `failed` as
  `not_applied`; and everything between (`approved`, `executing`, `executed`,
  `uncertain`) as `unknown`. While an episode is open, a consequential effect
  whose own earlier attempt is `confirmed` or `unknown` is refused before
  policy. Only one known not to have applied may be tried again. Receipts that
  cannot be read count as `unknown`.
- **An id's joiner keeps it whole.** A record name matches only as a whole
  phrase, and a hyphen, dot or slash between letters or digits continues
  the word: "Invoice B" is not named by "Invoice B-2" or "Invoice B.2". An
  `exclude` that forbids no effect class ("keep every other invoice") binds
  a step about a record the way a `scope` does: the control's row must name
  that record. The planner returned that sentence as either kind, and as
  `exclude` it bound nothing; a run deleted Invoice B-2 beside Invoice B.
- **A claim ends pressing what already worked.** Once a run has reported
  the task done and been refused, a press (`click`, `double_click`,
  `click_point`, `press_key`) on the same page and control as one it saw
  confirmed before that claim, and that took the run to another page, is
  refused (`agentRepeatsBeforeClaim`). A press that left the run where it
  was — "Load more", a tab, a disclosure — shows more of the page and stays
  allowed. The
  refusal sends the run to read or reopen the page instead. A refused
  completion means the evidence fell short, not the work. A checkout run
  that stopped at payment, as asked, went Back and sent its shipping form
  twice more to make the review page show the address. Links that only go
  somewhere are exempt, since reopening a page is what a refused completion
  asks for.
- **An unresolved effect gets evidence only.** An ambiguous verification is
  asked once more against the same before-picture, charged as an
  `unresolved_effect` attempt. Nothing is executed again. Confirmed advances,
  negative redecides with the episode open, and still-ambiguous pauses
  `unresolved_effect` exactly as before. The human reconciliation boundary is
  unchanged.
- **A refused completion gets one read, not the whole set.** A run that
  keeps claiming it is done trips the guard on its repeated `complete`. As
  `refused_completion` it is offered `targeted_read` only: waiting, pictures
  and other routes cannot supply the quotation it is missing, and in live
  runs they spent five strategies before the same question.
- **The reviewer is told what counts as a citation.** Every record in the
  review packet carries `citable`, computed by `agentReviewRecordCitable`, the
  same rule `applyAgentCompletionReview` enforces. Before this, a reviewer that
  judged a click-only change "supported" cited the activation effect, and the
  runtime refused it. That was the main source of questions on finished
  `stale` and `overlay` runs.
- **The reviewer is told what each outcome's own action produced.** A plan
  for "click Continue and report the status" carries "Continue is clicked" as
  a change outcome. No page text says "clicked", and a reviewer shown only
  "Status: Active" rightly calls that insufficient. The controller keeps, per
  requirement, the page before that requirement's verified page-changing step
  and the page before the run's next applied change. The review request lists
  `appearedAfterAction`: current quotes for that requirement that are absent
  from the first and, once the window closed, present in the second. Text
  another step produced, or text that was already there, is never marked.
  It is newly observed text, not proof. Beside it the request carries
  `actions`: the actions applied in each window, in order, as their receipts
  record them (command, control role and name; a sensitive control's name
  withheld). A verified change bound to the same requirement as the change
  right before it extends that window rather than replacing it, so a click
  and the accept on the confirm it raised stay together. The reviewer may use
  the text for an action-outcome only when one recorded action is the
  claimed one. Text after "click Accept" is no evidence that
  Continue was clicked, whatever requirement the model bound the click to.
  The runtime still requires a citable record, and the reviewer still judges
  what the text says. A worker with no
  windows (after a restart) sends nothing and claims nothing. Residual: an
  unrelated page update landing inside the window looks the same as the
  action's own result. The decision prompt tells the model that such an
  outcome's evidence is the text the action produced, never the control's own
  label.
- **Refused completions recover at the refusal limit.** Two identical
  refusals start `refused_completion` recovery (one targeted read). Only a
  third pair asks the user, prefixed with what was tried.
- **A second look at an ambiguous effect is per effect.** It is planned
  against the run-wide budget alone, not the open episode's tried list. It
  is charged in a `verifying` to `verifying` write before the verifier is
  asked again, and an open episode is kept as it was so its tried strategies
  stay tried. That write is the one status-preserving edge in the state machine, so a
  lost worker cannot refund it.
- **Watchers live until the effect settles, not until one `verify()` returns.**
  The write watch exists to catch a save whose request fails after the page has
  already shown "Saved", and the second look is taken three seconds after the
  first for exactly that page. A watch stopped by the first look leaves the
  second reading the same dead list. `AgentEffectPort.settled(receipt)` is
  called from the step's `finally`, so it runs on a pause, a throw and a lost
  verifier as well; a ceiling stops both watches if the controller never gets
  there. A write the network has not answered when a consequential effect is
  checked is on the receipt as `pending` and verifies `ambiguous`, since the
  page's own "Saved" was drawn before the server spoke. A routine effect
  ignores it: a request in flight could be any traffic the tab was sending.
  Child frames enable `Network` on their own session, and a request id is
  keyed by session, because it is only unique within one. Input the page never
  received (`undelivered`) is `ambiguous` with `interference`, `misdirected`
  and `partial`: a page change that follows is not the action's to claim.
- **Only the same control is a repeat while recovering.** A shared form
  address goes to policy, which asks. A checkout's next step posts to the
  same place as the one before it.
- **Exhaustion is specific.** No progress and refused commands ask a question
  prefixed by `agent.question_text.recovery_tried` with the spent count. A
  page that stays stale through `fresh_observation` and `wait_for_condition`
  fails `stale_snapshot` as it always did. An unreadable page is not a
  recovery trigger: it is a permission boundary, not a transient state.

### Grounded evidence ledger

- `sourceQuotes` on commands and completion proposes up to three short quotations.
  `evidence-ledger.ts` matches each against one authorized, identified source.
  A model note remains inference; it cannot create an observed fact. Composed
  frame text has no span identity, so child-frame facts need a non-editable ref
  or an explicit `extract_text` frame. Editable values and secret-shaped text
  are excluded. The durable host also applies the existing credential redactor.
- **Which tabs are open is the browser's to say.** Each observation lists
  the run's scoped tabs (`tabs`), the start tab first and marked, a tab the
  browser no longer knows marked `closed` rather than dropped. The model
  sees the open ones, so it can switch back to the start tab without asking;
  told only that a tab it did not open needs the user, it asked to return
  to its own. The judge reads the same list: "leave the source tabs open"
  is met when the run opened a tab and none it opened has closed
  (`keptTabsOpen`), wherever it has since been led — no quote shows it. A
  confirmed tab receipt names the tab it committed in (`evidence.tabId`),
  so a page item's tab is found by id after the run follows links inside
  it. Only a requirement is judged, so plan coverage
  (`agentUncoveredTabOutcomes`) refuses once, then adds itself, a tab
  outcome the user's words state that no change requirement does: a
  planner filed "open every source link in a separate tab and leave the
  source tabs open" as a scope constraint. A planner's `itemsFrom` with no
  items does not stop the page's links binding.
- **Leaving a source asks for its quotes once.** A step that leaves a page
  with nothing kept from its document is refused once, with the read it may
  answer named: a page naming an open read item, a link followed for a read,
  or a tab the run opened for any outcome while the plan still owes a read
  (named by its page item when it was one). Opening another tab or switching
  to one leaves the page as surely as navigating: a run opened both source
  tabs, saw each reference code, and switched away from both without a quote.
  Issuing the step again is the run's answer that nothing there is wanted. A
  `complete` on such a page is refused once the same way: the last tab of a
  list is never left, so its answer reached the summary unquoted.
- Records retain tab, frame, document, snapshot, generation, capture time,
  approved origin and optional requirement id. Origin is the only retained URL
  component of a source; a confirmed `open_tab` also keeps its destination's
  origin and path. No complete page, screenshot, command value or reasoning enters
  the ledger. User-answer references retain no answer text. Agent-input records
  identify authored documents without retaining the values the agent entered.
  Live authored text cannot be independent proof of the original fact. After
  restart those values are unavailable by design, so later quotations from the
  edited document are conservatively excluded as independent facts; verified
  effects can still describe what was checked. A new document may supply facts.
- Facts are recorded on the command's planned receipt before effects. A direct
  read answer commits its quotations with the terminal run checkpoint, without
  adding a fictitious action to the work log. Verification records retain the
  verifier's exact kind: `activation` does not become `save`. Their source is
  the action's observation, not an invented post-effect snapshot.
- Projection is bounded to 24 records and 12 KB, dropping oldest first
  within the eviction order `boundAgentEvidence` names. Prompt
  history and evidence share the existing history budget; omitted references
  mean unknown. Receipts remain the durable source through history compaction
  and worker recovery. Old receipts/checkpoints/handoffs decode without a ledger.
- Only an observed fact with the exact current snapshot identity is current.
  Navigation makes it historical; a new snapshot in the same document requires
  refresh, unless the same frame of that snapshot still states the quote and
  it repeats no value the run has entered since: every look takes a new
  snapshot, so a fact read on a page the run only looked at again (an
  extract, a scroll) otherwise fell below one read on a page it left.
  Without a live observation, retained support is historical. This
  records provenance, not semantic satisfaction of the task: completion checking
  and independent review are separate work.
- A read asking for current state (`requiresCurrentState`) still accepts a
  historical fact this run read, at or after its first step, when no change
  was applied after the reading and no effect is uncertain
  (`readableLedger`). The run is the present the user asked about; requiring
  each page to be open again sent a three-site comparison round the sites
  indefinitely. `requires_refresh` never counts, and a change after the
  reading returns the fact to history — except a confirmed field write
  (`field`, `fields`, `checked`) with no consequential class whose own
  receipt places it in a different document and a distinct source URL within
  the same completely enumerated page-source collection. An arbitrary edit
  document cannot establish the current value of a record viewed elsewhere. A
  submission, an older receipt without effect classes, an unlocated edit or
  any edit in the fact's own document still returns it to history.
- The settled chat handoff and follow-up carry the same bounded references as
  untrusted data. Excluded origins contribute nothing. A quote changed by
  handoff redaction is incomplete. `current_tab` and `read_tab` provide reference
  ids too, but lack document identity and a fresh capture timestamp; they say
  so and remain incomplete page-tool claims. Their retrieval time is not an
  observation time. Existing session/run deletion and receipt retention apply.
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
- **A row names its row, its time and its reasoning.** The collapsed row
  carries the target and the list row it sat in (`rowContext`, less the
  control's own label, via `agentRowContextBeyond`), so five Delete clicks
  name five files. The panel port keeps each step's first receipt time as
  `startedAt`, and a settled row shows how long it took. A click whose
  verification evidence is `native_dialog` reads "Dialog opened", not
  Verified — the file is not gone while its confirmation is on screen. The
  decision's streamed reasoning is collected by the model port, bounded to
  its tail (`MAX_AGENT_THINKING_CHARS`), filed on the step's first receipt
  and shown behind its own collapsed disclosure; it is dropped first if a
  receipt would overflow, and never read back into a prompt. The history the
  model reads keeps the target without `rowContext`.
- **A settled card keeps its record.** The card RPC carries the collapsed
  steps (without telemetry or page addresses) and a count of distinct pages;
  the card shows "N steps · M pages" over the same work log the live card
  drew, so the count is the rows' own. The result renders through chat's
  markdown renderer — it is the model's answer — while page-derived evidence
  in the rows stays flattened text.
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
## Durable workflow progress

`workflow.ts` derives a bounded checkpoint from the current task plan and full
receipt record before each decision. The checkpoint and selected quotations
ride the deciding CAS together. Older rows decode without this optional field;
resume rebuilds it before any model request or browser effect.

Each requirement or named item has a progress entry, exact evidence references,
receipt sequence for its latest applied or unresolved effect, and a fixed blocker
reason. Item identity uses the completion judge's existing whole-phrase rules,
so Invoice 1 is distinct from Invoice 10. `verified` uses the judge's exact
receipt-support rules. `effect_confirmed` only means an effect landed; it does
not prove a save or the whole goal. Model notes remain inferences. Neither notes
nor progress bypass completion, permission, policy or effect ownership checks.
For a read outcome, retained facts mark it `supported` after any revealing effect
is settled; the exact effect reference remains, and an unresolved effect still
requires reconciliation. A read over a collection the user did not enumerate
("review all pages", "every step") also carries `coverage`: the number of
distinct documents with grounded facts for it, with evidence ids chosen one per
document first, and `extent: "unknown"`, because nothing observed fixed how many
documents there are. Such an entry is never counted as done in the panel, and a
page visit, a page count or reaching the last page adds no coverage. A projected
entry whose evidence fell out of the ledger counts only the documents still shown. User answers retain content-free provenance references
in the same bounded ledger, but never count as independently observed facts.

Plan-bound facts get retention priority, one source per unit before additional
sources. A first fact per item/document precedes answer references, which precede
extra same-source detail; all compete in one retention pass. The existing ledger
count/byte ceilings and twelve-step recent history
remain. Facts from inactive or closed documents remain historical quotations;
a new snapshot of the same document requires refresh unless its same frame
still states the quote and the quote passes the run-entered-value guard.
Superseded, missing,
unauthorized or prompt-omitted support remains unknown. Receipt-read failures
mark cached effects uncertain instead of presenting them as new work.

Phases are a bounded cursor over the current requirements/items followed by
review, rather than nested runs. A phase never refunds steps, active time,
provider retries, recovery attempts or request token budgets. Workflow, ledger,
recent history and inference notes share the existing context allocation; an
oversized workflow is omitted whole with an explicit continuity warning.
If fixed checkpoint metadata cannot fit, continuity is omitted and any older
checkpoint is cleared; the decision continues with bounded receipt recall.
Terminal compaction drops the redundant workflow checkpoint, retaining outcomes,
quotations and authoritative effect receipts for the report and handoff.
Read dependencies attached to change outcomes are checked before consequential
effects using the same read-prerequisite judge and durable tier-preserving
receipt as read-first phases. Preparatory field entry remains available unless
a separate read-first phase forbids it. Since a model requirement tag cannot
prove an effect independent, all pending commit dependencies are checked for
every consequential effect. This conservative boundary can hold unrelated
commits. Missing references fail closed; plan-version changes invalidate old
proof reuse. See the task contract for planning and collection limits.

## Controlled-file foundation (incomplete)

`agent-artifacts.ts` defines opaque run-owned handles, MIME/byte/count limits,
SHA-256 identity and a 24-hour access lifetime. `artifacts.ts` is a pure
port-driven service. The host must authorize an upload's exact run, step,
artifact digest and destination against its persisted policy/effect claim.
The durable store uses the existing SQLite owner, with migration 19 and run
foreign keys. Content expiration never removes upload ownership: an uncertain
upload remains non-replayable until its run is deleted. Each artifact can be
uploaded only once per run, including across different destinations.

This is a foundation, not a shipped file-action capability. Browser download
tracking/content acquisition, parser-host binding, authenticated user selection,
model schema/actions, resolver/policy/executor/verifier wiring, supervision UI
and the scripted browser acceptance suite remain to be implemented. Do not
advertise controlled file workflows or claim PR 13 acceptance from the service
unit tests. Existing file-selection takeover behavior remains the available path.
## Opt-in unattended execution

Pause the current run, explicitly enable **Continue this task with the panel
closed**, then Resume. Consent is stored and flushed at the exact displayed
user pause. Closing the last subscription grants no consent. Runs without
consent retain pause-on-close. Consent names the current origins, tabs, provider
and model; it is never inherited by a new or follow-up run. Scope expansion
prevents panel-close continuation until the user reviews consent again.

The toolbar shows `RUN` while unattended work is active and `!` at human
boundaries. **Stop browser agent** in the page context menu and the **Stop the
current browser agent run** extension shortcut stop through the same durable
cancellation path, without opening a panel. The default shortcut is
Alt+Shift+X (Command+Shift+X on macOS); browser conflicts may require rebinding
it in extension shortcut settings.

Startup first performs the existing durable recovery. Only submitted,
observing and deciding phases of opted-in runs become `worker_lost` checkpoints
eligible for automatic continuation. The service rechecks the Agent switch, browser-session identity, perception permission, supported page access, the approved origin,
controlled tab and provider/model before resuming from a fresh observation.
Continuation is registered with the startup supervisor after workflow recovery.
Its AbortSignal guards revalidation, browser attachment and each mutation before
the first durable resume checkpoint. After that checkpoint, the run service owns
the existing bounded execution loop rather than inheriting the startup deadline.
Panel-free work pauses if its tab, origin or provider/model scope later grows.
Executing/verifying effects remain uncertain and require human reconciliation;
no saved command is replayed. Pending human requests are retained in the
checkpoint; an interrupted approval or takeover stays paused and requires
fresh page validation and consent, rather than accepting a stale request.

Browser-session identity uses session-only extension storage. Browser shutdown
clears it, preventing consent from attaching to a recycled tab id. If the optional alarms permission is already granted, a one-minute browser
alarm wakes the worker to run the same consent and permission revalidation.
Without that permission, recovery waits for another worker wake. No cloud
runner or execution while the machine is off is introduced.
Best-effort browser API heartbeats run only during active authorized work;
human waits may let MV3 sleep. Existing active-time and provider budgets still
apply, and lost time/network may end or pause work. Automatic recovery on the next worker wake does not guarantee immediate
waking after worker termination. Existing notification permission enables a
content-free completion or attention notification; otherwise the toolbar badge
remains the indicator. The stop menu is localized and visible only while a
non-terminal run exists.

`verify:sw-agent-recovery` kills the actual packaged worker for both supervised
and opted-in interrupted effects. It also seeds a real tab with persisted browser-session, origin, provider/model consent, kills the worker and proves one new read-only decision from the replacement. Its held decision scenarios close the actual supervision page and stop from an authenticated extension page while no side panel exists. The latter exercises the durable stop transport, not native context-menu interaction. Unit and SQLite tests cover safe checkpoint
selection, scope/permission/session rejection, durable consent, unanswered
human boundaries, panel-close continuation, indicators and external stopping.
Scripted/unit success is not live-model qualification. Browser acceptance must
be run in an environment with the packaged extension and Chromium available.
## Release review hardening

HTML-to-text conversion uses inert template contents; parser-created nodes never
enter the live document. Submission dispatch lets all delegated page listeners
finish before a guarded native default. A navigation deadline is a typed timeout,
not a cancellation; submission verification reads the fresh page after that
specific timeout without reissuing the effect.

Completion quotations use Unicode phrase boundaries. Typed record states and
control transitions avoid global occurrence counting across overlapping text
sources. A renamed control requires a verifier receipt binding its before/after
names, document, frame and stable identity; a different Reopen button is no proof.
Current-state reads require current source support. Item summaries consume judged
item outcomes; screenshot-only support is labeled as seen in a screenshot, and
an outcome's tier decides its label (see [Outcome tiers](agent-verification.md#outcome-tiers)).

Decision system policy stays fixed. The schema stays fixed for the run's measured
model modality; visual availability travels in the user observation and the parser
still refuses unavailable commands. Cache, reasoning and reported cost counters
are retained on decision receipts. A cumulative one-million-token accounting
ceiling, including review, is checked before further decisions and survives worker
recovery through receipts. An already bounded request may cross that ceiling;
provider omissions and interrupted requests prevent exact billing guarantees.

Scope constraints without authoritative record bindings and monetary limits without
supported control-bound displayed offer terms refuse consequential work before
approval (see the policy contract for the bounded price recognizer). They
remain on the plan and require a human handoff, rather than accepting a model's
claim that the destination or price is within bounds. General observation-time
challenge detection covers rendered password login forms and explicit human
verification gates; localized or unusual challenges can still require the model's
existing takeover path.

Chat keeps conversation history regardless of model parameter-count substrings.
Dynamic retrieved context, active-tab metadata and date/tool guidance are appended
to the current user message, keeping the configured system policy stable.
LM Studio reads loaded-instance context lengths from `/api/v1/models`, taking
the smallest routed instance when several are loaded. llama.cpp reads the slot
window from `/props`. Missing loaded-window evidence stays unknown; a training
maximum is not an allocated server window. These optional metadata requests do
not gate the model catalog.

References: [LM Studio model list](https://lmstudio.ai/docs/developer/rest/list),
[llama.cpp server properties](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md#get-props-get-server-global-properties).
