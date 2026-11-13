# Browser agent: verification

Detailed implementation contracts. Start with [AGENT_INTERNALS.md](../../AGENT_INTERNALS.md) and read only the sections relevant to the change. Repair history explains existing behavior; it is not evidence of live-model reliability.

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
  read needs an independently observed quotation retained in the evidence ledger.
  Current quotes are grounded before judging; historical observed facts survive
  navigation and restart, while requires_refresh and model/input records do not
  prove a read. A fact from an earlier snapshot of the document still open is
  current again when that frame of the current observation still states it
  and it repeats no value the run has entered since. A quote establishes provenance, never automatic goal satisfaction.
  Typed plan checks decide exact field, checked/selected, URL, row and record
  save/submission states; ambiguous claims return needs_review for independent
  review. Save/submission indicators must name the exact record in a current
  status/alert; ordinary document prose needs review. Bounded whole-row text
  cannot establish record identity for scoped controls; those need review.
  Row predicates require the complete row label to equal the record name.
  An explicit predicate is authoritative: an ambiguous identity/state needs
  review and must never fall back to an action receipt proving a weaker claim.
  Planned result text is built from the judged outcomes, never the model's
  free-form success summary. Itemized reads report only the checked item quotes,
  never their unchecked parent quote. Completion retries only read; effects are retained.
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
- **A run's budget grows with its plan, under one ceiling.**
  `agentObservationBudget` gives fifty, plus twelve per outcome past the first
  and six per item past the first, capped at `MAX_AGENT_OBSERVATION_CEILING`
  (120); the active-time budget grows in the same proportion. A three-site
  comparison needed more than fifty looks, and a runaway loop on a one-line
  task still stops at fifty. Every bound that must hold for any run — receipt
  counts, step numbers, the panel's list, `MAX_AGENT_STEPS` — reads the
  ceiling; the loop and the panel read the run's own budget. The card also
  shows how many parts of a multi-part plan the durable workflow has done.

### Provider resilience

Planning, decisions and completion reviews share `agent-model-retry.ts`.
Authentication, CORS, configuration, capability mismatch and explicit wire
refusals are permanent; provider statuses and closed error codes determine
retryability, never raw prose. Typed rate limits, temporary service failures
and dropped connections have at most two retries with exponential backoff.
`Retry-After` is a minimum wait; guidance that cannot fit the remaining budget
stops with the original provider error instead of retrying early.

Malformed-output retries have their own existing budgets. All attempts and
backoff share the decision timeout and the remaining active run/step time;
waiting does not suspend the durable deadline. Cancellation aborts the active
request or wait and removes timers/listeners. Every attempt starts a fresh
collector and rechecks the selected provider's enabled gate. There is no
fallback provider. Inference retries have no browser-effect port, so a failed
request after a verified click retains its receipts/evidence without replaying
that click. A permanent planning error cannot become a provisional amendment.
Provider retry counts and backoff time are optional, numeric receipt telemetry,
separate from malformed retries; review has separate fields for those costs.

### Independent completion review

A `needs_review` refusal that carries a `review` scope is put to a second
reading before it reaches the model (`completion-review.ts`,
`AgentCompletionReviewPort`). The scope names exactly the requirement and
constraint ids no deterministic check could decide, plus the judge's outcome
for every other id. Rules, all load-bearing:

- **Only undecidable claims are reviewed.** A deterministic failure returns
  before a scope is built, so a reviewer never sees one and cannot override
  it. An accepted completion pays for a review only when it carries claimed
  reads (see [Outcome tiers](#outcome-tiers)); a verified outcome is never
  put to one. A broken limit wins
  over a reviewable one whatever order they were planned in. Missing effect
  classes are an evidence gap, not a question of meaning, and carry no scope.
- **A paraphrased read goes to review only if something could answer it.**
  The ledger has to hold a grounded observed fact bound to that requirement.
  With nothing bound, the read is still `absent_evidence`.
- **Fresh context, no effects.** The reviewer sees the goal, the scoped
  requirements and limits, the acting model's proposed answer for those ids,
  the grounded ledger records, and the title and a bounded excerpt of the
  page the run completed on — no history, screenshot, summary, notes or
  reasoning. For a change, the proposed answer is only whether the model
  says it is met: its evidence text is its own argument, and the page's words
  reach the reviewer through the ledger. A read keeps its text, because there
  the text is the answer being judged. The page excerpt is context: only a
  ledger record can be cited.
  It lists each outcome's key points before its verdict; they are its
  working and never read as support. It has no browser, approval or plan
  port. The prompt keeps all page-derived text in one JSON data block, with
  `<` escaped so a quotation cannot close it.
- **The runtime checks every verdict.** `supported` counts only with a cited
  ledger record that is grounded, `current` or `historical`, and bound to
  exactly the id under review. An unbound fact is plausible evidence of
  anything, so it counts for nothing. A read or a limit is shown by an
  observed fact. A change may also be shown by a verified effect whose kind
  proves the resulting state (`field`, `fields`, `checked`, `arrangement`,
  `condition`); an activation, submission or navigation only says the input
  landed. A limit is supported by a quotation the run bound to that limit's
  id, which `groundAgentQuotes` accepts alongside requirement ids. One
  exception: a `scope` limit — one on how the run acted, such as which key
  it pressed — may also cite any grounded `verified_effect`, unbound, but
  only when the review request carries `actionsComplete`, i.e. the reviewer
  was shown every applied action the run took. No record is ever bound to
  a limit's id and no page quote can show which key was pressed, so without
  this every method limit could only be refused; the reviewer still judges
  the limit against the full action list, and a spending cap or other
  non-`scope` limit keeps the bound-quotation rule. An `exclude` ("don't
  reorder anything else") is answered the same way, by the actions.
  An exclusion about a read-only answer ("Exclude Archive") cites a fact bound
  to one of the answer's reads, and when its wording names what it excludes,
  the verdict also needs the proposed answer not to pick that subject in a
  sentence that does not say it was left out, and at least one cited fact
  not about it. The proposed answer can only lose such a verdict; it is
  never evidence.
  Before review, an `exclude` about changing things ("don't approve or change
  anything") is settled by the receipts alone when the run applied no change
  and nothing is uncertain; one that also speaks of where the run goes stays
  with review, and one that excludes change itself still needs that, or a
  reviewer, even when the planner forbade a class for part of it.
  Ids nobody asked about are ignored. A skipped or doubled answer is
  insufficient. `contradicted` becomes `contradicted_state`, citations or
  not, because it can only stop a success.
- **Itemized requirements are reviewed only item by item.** A verdict
  answers for the whole requirement, and one citation cannot say which item
  it supports, so a refusal that includes an itemized requirement keeps no
  review scope — except a change whose every item is answered met by its own
  quote naming that item alone, and a read answered twice for its one item.
  A supported verdict on such a change counts only when its citations
  include a quote naming each item.
- **No review is never a pass.** A missing port, a thrown or timed-out call,
  a malformed answer, a prompt too large for the reviewer's resolved window,
  and a spent budget (`MAX_AGENT_COMPLETION_REVIEWS` per run) all leave the
  judge's refusal unchanged. The prompt is never cut to fit, because a
  reviewer must not judge evidence it was not shown. The budget is read from
  the run's receipts as well as from memory, so a worker restart cannot
  refund it.
- **A spent budget does not settle a contradicted id.** When the last
  verdict on an id still awaiting review was `contradicted`, a completion
  that would otherwise settle pauses with a question instead: reporting it
  as merely unchecked would call done what the only independent reading
  said was not. The ids ride the receipt that records the review's cost
  (`reviewContradicted`, ids only), so a restarted worker rebuilds them
  beside the budget; the user's answer clears them, and a receipt older
  than the newest answer is not read back. The set is kept to the current
  plan's requirement and constraint ids, so one an amendment removed is
  neither disputed nor recorded past the receipt's bound.
- **Confirmed writes show their values.** An action whose verifier
  confirmed `field`, `fields` or `checked` carries `set` in the review
  request: each named control and the value, typed text or checked state
  it was left holding. Sensitive controls and unnamed ones are left out.
  The values live only in the controller's memory, because receipts store
  command values redacted, so a restarted worker's review goes without them.
  When a by-actions limit replaces the outcome windows with every applied
  action, each action still carries the values its own outcome's window
  holds for its exact step id. Repeated control names never transfer values
  between writes, including later writes with uncertain effects. The internal
  step binding is removed before projection.
- **A batch that held another outcome's check is that outcome's receipt
  too.** A confirmed batch is filed under one requirement id, and the
  verifier records every other requirement whose typed check it held exactly
  (`heldPlannedFor`: name, value or checked state, record). The review
  request binds a copy of its `fields` effect record to that id
  (`<id>~<requirement>`) and lists its action, with `set`, under that id
  too. Only when the batch is that requirement's latest applied write, its
  verification confirmed, and the runtime reads the check holding on the
  page under review for its record (`checkCompletionState`), or the existing
  carried-off rule establishes that a commit removed the form. Historical
  field support requires a complete observation with the control absent and
  the expected record named by the result heading/title. A followed link, a
  reset control, another record, or an uncertain later write cannot substitute.
  This makes the field receipt citable for review; it does not prove the
  commit succeeded or promote the outcome automatically.
- **Listed amounts settle only a bound on listed values.** A read-only run
  holds "stay under N unit" without review when every quoted amount in that
  unit is within it and the user's words name neither a total nor a spend or
  usage ("spend", "budget", "research", "fees"). Those bounds go to review:
  quoted prices cannot show what the run or the user spent, and the sum of
  candidates read is not a spend.
- **A cap on what a change chose is judged from the reads it depends on.**
  On a plan that changes something, the review request's `answerIds` are the
  reads a change `requires` that the judge already met (never one still
  under review). A limit such as "don't book anything over 120 credits a
  night" may then cite a fact bound to one of those reads — the comparison's
  own price line — because nothing is ever bound to the limit's id. The
  reviewer must tie that fact to the item the recorded actions and the
  change's own records show it acted on; the runtime checks only that the
  citation is such a fact. Change outcomes carry `dependsOn` in the review
  data so the reviewer can use those reads as context for whether the right
  item was acted on; they never show the change took effect, which still
  needs a record bound to the change's own id. A change without `requires`,
  or with an unmet read, keeps the bound-quotation rule.
- **Read-only limit reviews retain the proposed answer.** Even when a read
  is already checked and only its exclusion or budget remains under review,
  the reviewer receives that read's claims and the proposed answer inside
  the untrusted data block. They describe which result to judge, never
  evidence or instructions. Only retained independent facts can support the
  limit; checked outcomes are not reopened for new supported verdicts.
- **An item reported unmet keeps its requirement unmet.** An itemized
  requirement with any item answered `met:false` settles as unmet and is
  never put to review: a supported verdict on its other items would
  otherwise carry the whole requirement into `met`. The existing two-refusal
  question to the user still bounds the loop. Nothing is re-executed to
  satisfy a reviewer; the feedback says so.
- **Default reviewer is the run's own model and provider**, already
  authorized and already shown every ledger record, so a review discloses
  nothing new. It is bounded by the decision timeout, retried once on
  malformed output and up to twice on eligible transient provider failures,
  and run without a reasoning budget.
- **A separately configured reviewer passes the run's own gates first.**
  Settings → Agent → Completion reviewer (`AGENT_COMPLETION_REVIEWER`) names
  a provider and model. `resolveAgentCompletionReviewer`
  (`src/background/agent/`) refuses it when its provider is gone, and when its
  endpoint is remote and page content has not been acknowledged for remote
  models. The port then applies the same enabled and tool-calling checks a
  decision gets, resolved for that model. A refusal at any gate means no
  review. It never falls back to the run's model: that would change who
  judges without the user knowing. `reviewSeparateModel` marks these reviews
  in telemetry so the two kinds of reviewer can be compared.
- **Cost and disagreement are durable.** `reviews`, `reviewMs`,
  `reviewPromptTokens`, `reviewOutputTokens` and `reviewDisagreements` land
  on the completion's own receipt: the rejected completion step, or a
  `:review:` step written when the review settled the run. The benchmark
  sums them per attempt. Read them against task predicates, because a
  reviewer can be wrong in both directions.

### Page-link items

- **"Every link" is enumerated from the starting page.** Planning happens
  before the run looks, so "open every source link in a separate tab"
  arrived as one change naming nothing, and a run that opened both links
  was refused every completion. On the run's first look, before any step,
  `agentPlanWithPageLinks` (`plan-page-items.ts`) gives a first-plan
  `change` entry with no items of its own, whose own `text` — never its
  `source` or the user's words — has every, all or each followed within
  three words by link(s), the names of the distinct visible links in the
  root frame. Nothing else is read: no verb, negation or clause. Whether
  the user meant only opening the links is not decided by wording, because
  the items credit nothing (below); a mis-binding adds a list for the
  reviewer, never a completion. A negated entry is a constraint, not a
  change. Read entries also enumerate explicitly quantified links or linked
  pages, with the additional coverage checks below.
  The page itself, fragment links, downloads and sensitive links are left
  out. A qualifier between the quantifier and "link" ("source") keeps only
  links whose name or path carries its stem.
- **An ambiguous page binds nothing.** No matching link, a link below the
  fold whose name carries the qualifier (its address is withheld, so the
  list would be partial), two links sharing
  a name ("Read more"), a name over the item length, more links than
  `MAX_AGENT_REQUIREMENT_ITEMS`, or a plan total past `MAX_AGENT_PLAN_ITEMS`
  leaves the entry as planned. A link an `exclude` constraint names is never
  owed by a change; a read is narrowed only by an exclusion of reading itself
  ("skip", "do not read"), never by one of buying or another effect. A page
  that reads as injected writes nothing into the plan. "All linked pages" and
  "all pages linked here" name the same collection.
- **Read coverage needs the complete starting-page collection.** For explicit
  quantified linked-page reads, runtime-only `pageItemsComplete` marks whether
  this first observation supplied an unambiguous bounded set. Partial or
  offscreen lists, duplicate names, query/fragment-dependent addresses, pagination
  controls, conflicting planner items and exceeded bounds leave coverage
  unknown. Missing metadata also means unknown, including legacy runs. A
  reworded criterion keeps its items and links but not its completeness, and a
  quantified read an amendment adds is enumerated only from the page its
  user's own answer points at unambiguously ("every source link here"; not
  "the page", or wording that may mean an earlier one), and only when no
  step other than looking ran after that answer; otherwise it is of unknown
  coverage and reported unmet, never enumerated from whatever page the run is
  on and never claimed complete. Entries of the first plan are never re-bound
  from a later page. This
  does not traverse pagination, recursively discover links or prove coverage
  of an arbitrary multi-page form. It snapshots the starting page's collection;
  it does not certify that a site has no dynamically undisclosed sources.
- **Each read item needs its own observed source.** `groundAgentQuotes` attaches
  `sourcePage` only to an authorized text quotation at an enumerated destination,
  with the same bounded query-free address used by `itemLinks`. Completion needs
  a retained current or historical fact for that requirement and source, for
  every item claimed met. Tab visits, screenshots, another page's quotation,
  stale facts and a permissive review cannot bypass this gate. An honestly
  unmet collection can still settle without invented evidence. Provenance
  establishes where the text came from; the existing semantic completion
  checks still decide whether that text answers the requested work.
- **The items are page data.** `itemsFrom: "page"` marks them, and
  `itemLinks` keeps each one's origin and path. They only enumerate the
  user's own quantifier and never widen it; no user quotation is asked of
  them, and the decision, planning and review prompts each say they are the
  page's own link names. An amendment that restates the items unchanged
  keeps the mark (`agentPageItemsCarried`); one that changes them drops it.
- **Bound once, in the deciding claim.** The items are written in the same
  claim as the first observation count, so a worker restart resumes with
  them rather than binding again from whatever page it is on.
- **Page items are an enumeration, never a credit.** Once every item is
  answered met and has its own confirmed `open_tab` receipt at its link
  (`agentPageItemTabs`), read per step so the planned row's tag reaches the
  verified one, the item is met only when the outcome asks for nothing but
  the opening and the observation's tab list shows each link open in a tab
  now (`pageItemTabsOpen`). Otherwise — more asked of an item, a tab since
  closed or moved on, a host that sent no list — a refusal for want of
  proof becomes `needs_review` with a review scope: the completion reviewer
  is the judge of what each item owes, and what it carries is `supported`,
  never `verified`. A reviewer asked whether a tab is open gave three
  answers on one unchanged record; the browser gives one. A
  contradicted, stale or self-quoted item stays refused, and an item the
  run proved by its own quote or receipt is judged as before. In the
  reviewer's citation gate a verified tab record whose destination is an
  item's link names that item (`agentTabOpensPageItem`), as a quote naming
  it does, and is offered to the reviewer as that outcome's
  (`agentReviewRecordFor`). The address names the item, so a tab counts
  tagged for the requirement or untagged — a run asked to keep a page's
  quotes first re-sent its `open_tab` without the tag — but never tagged
  for another outcome. That is
  only the citation's shape: the review prompt says a tab shows only that
  the page opened, supporting an item only when the outcome asks for
  nothing more, and any other act on it (upvote, like, delete, save,
  reply) needs its own evidence.
- **Tab receipts say where they went.** A confirmed `open_tab`'s ledger
  record carries `destination`, origin and path, as its step receipt does.
  When the ledger is full, a landing receipt bound to no outcome goes
  before one bound to an outcome: a run that switched tabs four times had
  evicted the first open, the only receipt for half its outcome.

### Outcome tiers

A met requirement is not one answer but three, and the run records which.

- **`verified`**: a check the runtime ran itself held on fresh evidence — a
  typed predicate on the current page, a result-verified receipt, an
  accepted submission bound to it, a read whose quote lies in the row of the
  record its `row` check names, an itemized read whose quote names its item.
- **`supported`**: an independent reviewer judged it from grounded facts.
  The most a model's verdict can reach; nothing a reviewer says mints
  `verified`.
- **`claimed`**: the acting model's word. A read whose grounded quote nothing
  tied to the question — a quote proves where words came from, not that they
  answer it, and an exact quote from the wrong row is grounded too — a read
  taken off a screenshot, and a kept change that was never read back.

`AgentRunOutcome.supported` and `.claimed` list the ids; a met id in neither
is verified, and `visual` still marks the screenshot reads (claimed). A
completion with any claimed outcome settles as **`completed_unverified`**,
reached only from `deciding`: amber on the card, "Reported, not checked" in
the result, and the benchmark scores it as a success claim, so a wrong one
is still a false completion. Claimed reads go to the completion reviewer
before settling; each one it supports with a citable record bound to it
moves to supported, a contradiction refuses the completion, anything else
leaves it claimed. A claimed save is not offered: no verdict on facts
already gathered can supply a page that was never loaded.

A reviewer can lower any tier, never raise one past `supported`. Every
review request lists, as `checked`, the outcomes already graded verified or
supported outside its scope. A `contradicted` verdict on one of them, given
once and citing a record the request carried, moves it to claimed
(`applyAgentReviewDowngrades`), so the run settles amber rather than green.
It never refuses the completion: the runtime's check still happened, and a
model's word alone does not undo it. No review is ever requested just to
look for downgrades; they ride on a review the run was already paying for.

- **A submission that went is not one the site took.** The verifier records
  `acceptance` on a confirmed submission: `rejected` when a control the page
  marks invalid is showing, `accepted` when the page moved on — a new
  document or the named destination — with no new alert, `dispatched`
  otherwise. Only an accepted one binds a submission requirement. A step
  classed as a save or a send (`save`, `submission`, `potential_commit`)
  carries a filled field off the page unless the site turned it away
  (`rejected`), since an SPA save need not navigate; an unclassed
  submission carries it only once accepted (`savedAway`, `savedOrSent`,
  `completion-support.ts`). A receipt without the field counts as
  dispatched. A field marked invalid never satisfies its check.
- **Leaving is not keeping.** A value whose control is gone from the page is
  credited from its own write only when the step that left the write's page
  carried it — a save, a send, or a non-link press whose own activation left
  ("Continue", a GET form's button, a save that then navigated) — or a save
  or send on the write's own page came before that step
  (`carriedOff`, `completion-support.ts`). A link after an in-page
  "Preview", or an "Accept cookies" on the page a link opened, carries
  nothing, and neither does a submission the site turned away (`rejected`),
  whatever save or submission class its control carries.
- **A control set to the act's negation is not the act.** "Do not publish"
  holds against a box checked or an option chosen for publishing, single or
  in a batch alike; "Not published", "Don't publish" or "Unpublished" is not
  that, and goes to review instead of contradicting the limit.
- **A commit's retained outcome reaches review, never a verified state.** A
  `record_state` quote is verified only on the current page. Once the run has
  left, a quote is sent to independent review instead of being refused only
  when it was kept for that requirement on the same tab and frame, from a document other
  than the one the run's own confirmed commit (submission, save or potential
  commit) was issued on, at a later generation, with no other change receipt
  or non-read effect between them, and no consequential step at all after the
  quote was read — whatever requirement the model tagged it with, and whether
  or not its label names the record ("Revoke"). The one exception is a step
  whose runtime-resolved row names exactly one other record the plan declares
  and neither the row nor the control names this one. The
  record must be named as a whole (`agentTextNamesRecord`), and a reader
  instruction such as "Do not submit again" is not a reported failure. The
  full step receipts must also be
  available and rule out intervening navigation; eviction from the bounded
  evidence ledger cannot make a later page count as the commit's result.
  Another record, a reported failure, a
  stale or other-tab quote, an unsettled commit or a later page stays
  unreadable, and a page that is gone is never grounds to re-apply. Wording
  such as "Saved" against "submitted" is the reviewer's judgment.
- **Staleness survives a restart.** Besides the worker's baseline, a quote
  the ledger recorded in the same document at or before the generation the
  change was decided on is stale. Ordered by snapshot generation, never by
  clock: the page and the worker keep different ones.
- **A kept change is read back.** A requirement marked `persist` — by the
  planner, or by rule from a saved or deleted `record_state` check — is
  verified only when its typed check holds on a page loaded after its
  change: a confirmed `navigate` or `open_tab` afterwards, or an accepted
  submission that moved on (`back` is not one; a cached page returns what it
  showed). A navigation alone proves nothing — a field receipt can vouch for
  a value the reopened record lost — and a kept change with no check cannot
  be read back by rule, so it stays claimed without the run being asked. Shown only on the page
  where it was made, the completion is refused once with `readback_required`
  and the runtime reopens the record itself (`readbackProbe`): an ordinary
  `open_tab` of the page the change was made on, so the resolver, policy,
  approval, ownership and cancellation all apply and nothing is resubmitted.
  Asking the model to reopen it did not work — models waited on the saved
  page. A change that was a submission is never probed, since reloading the
  page a form posted to asks the site for something else; that case is still
  asked once. Asked already, it settles as claimed. Whether it was asked is
  read from the refusal's fixed template in the receipts.
- **A superlative read is computed, not taken.** For each item of a planned
  read the run says it met, the grounded quote it cited and the one number
  that quote holds form the collected records (`collected-records.ts`). A
  read asking for the cheapest or the highest is computed from them when one
  itemized read covers every item with a number and the winner is unique: an
  answer naming the computed item, at the computed number if it states one,
  is verified without a quote of its own, and one naming another collected
  item is refused with the computed answer. Anything less is not a
  computation and stays with the reviewer.
- **A whole status message is evidence for its own item.** A change
  quotation has to lead with its item, so a cut from the middle of a row
  cannot credit the next one. A `status` or `alert` message quoted whole is
  one message about one thing whatever its word order ("Order placed for
  Blue Kettle"), and counts when it names the item and no other.
- **Custom controls report their state.** The observation carries
  `ariaChecked`, `pressed`, `expanded`, `selected`, `activeOption` and
  `invalid` with `invalidMessage`. `checked` stays native-only, because
  `check` and `uncheck` drive a native input; the `checked` predicate reads
  native, then `aria-checked`, `aria-pressed`, `aria-selected`, and
  `selected` reads `selectedOption`: the one option marked selected in the
  listbox the control owns (itself, or the one its `aria-controls` /
  `aria-owns` names), read in the page where ownership is known — never
  another dropdown's choice in the same frame, never a combobox's typed text. `invalid` comes
  from `aria-invalid` or `:user-invalid`, so an untouched required field is
  not read as rejected. These fields are in `pageEvidence`, so flipping a
  switch is a confirmed change rather than an ambiguous click.
- **The user reads the grades, not only the chat's account of them.** The
  card lists the run's contract — each outcome with its tier, each limit —
  folded under a chat answer and open when the card stands alone, and a
  settled run that is not plainly `completed` carries a fixed banner drawn
  from its status alone. The handoff a later turn reads lists the same tiers
  and the consequential actions that landed or may have (`applied`,
  `uncertain`), so a follow-up answer can say which outcomes were checked. A
  budget that ended the run names itself through `messageKey`: steps, time
  or tokens.
