# Browser agent: task contract

Detailed implementation contracts. Start with [AGENT_INTERNALS.md](../../AGENT_INTERNALS.md) and read only the sections relevant to the change. Repair history explains existing behavior; it is not evidence of live-model reliability.

## Task-completion contracts

- Clarifications carry their question and answer into `agent-model-port.ts`.
  A user correction applies only to the exact user-paused state (`pausedAt`);
  it cannot resume an unresolved side effect or answer an approval.
- **A run can be steered without pausing it.** `agent_steer` queues text in
  the controller that is driving the run; the next `deciding` claim writes it
  as an answer ("User correction while the run was working") and clears the
  no-progress and refusal memory, because it describes an approach the user
  just corrected. The decision already in flight never hears it. It answers
  nothing and resumes nothing, and a run this worker is not driving refuses
  it (`steer_unavailable`). An accepted correction leaves the queue only once
  the claim recording it has landed — a pause that wins that claim keeps it
  for the decision after the resume — and a run that reached a terminal
  state drops what it never heard. The queue is memory only, so a worker
  restart loses it; the card says when the words were taken.
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
  approval. When the plan has a single change requirement, an accept
  that names none advances the requirement of the step that opened the dialog;
  with more than one, the model binds it, since the plan may have given the
  confirmation its own. Browser fixtures must register a passive Playwright dialog
  listener, otherwise Playwright dismisses it before the extension can answer.
- **An early "not met" is asked about once.** `partial` and `unmet` are the
  model's own answers and the judge takes them as given, but a run that fixed
  a typo and answered "save: not met" without ever pressing Save had stopped,
  not failed. While observations remain, the first `met:false` on each
  requirement comes back as a `premature_unmet` refusal naming the ids; the
  second answer settles the run. The prompt says `met:false` is for what
  cannot be done, not what is not done yet. The question is asked of the
  model's own `met:false` answers also when the claim was refused only for
  want of proof (`absent_evidence`, `missing_evidence`, `unverified_change`,
  `needs_review`) — a limit no one could cite otherwise let a run stop one
  click short and settle partial without being asked. A contradiction keeps
  its own feedback, and the honest partial still settles after the answer.
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
- **One field receipt does not verify a whole form.** Scalar, batch and quoted
  field receipts must cover the entire requirement before receiving native
  completion credit. A Name receipt cannot verify an outcome also asking for
  Color or Agree, even when a Name-only predicate is attached to it. Known
  partial support goes to review; an absent or invented quote remains refused.
  Workflow progress applies the same scope check, including held-value receipts.
  Atomic field obligations retain native verification; semantic or composite
  outcomes still need evidence for everything they assert.
- Planning is optional only at the host boundary. A host with no planning port
  retains the legacy completion path, but once the port exists an exhausted or
  empty plan fails the run before its first observation. Planning failure must
  never buy the weaker pre-requirements judge. A run paused or asked a
  question before its plan landed resumes into `planning`, never past it.
- **A planning repair sees the rejected proposal.** After a completed planning
  response fails validation, the single format retry receives schema-owned
  argument data plus the corrective feedback. It is labeled as untrusted model
  output; the original user request, answers and current plan remain authority.
  Independent requirement validation failures are reported together (including
  unquoted items and unsupported read-first flags), so repairing the first
  error does not conceal another until the only retry is spent. Any failure
  rejects the whole proposal; collected valid entries never become a partial
  accepted plan.
  The model returns a whole plan, which passes every existing source, value,
  ordering, capacity and removal check again. Count-inferred page or row labels
  must be omitted from `items` while their full coverage obligation stays in text.
  Proposal context uses only spare model-window room and at most one response's
  character allowance. An oversized proposal is omitted whole, never cut through
  literals or sources. Unknown fields and provider metadata are excluded; neither
  reasoning blocks nor interrupted transport output become repair data. Context
  lives only within that planning call. Retry counts and deadlines do not reset.
- **The task contract is the goal plus three things the planner derives from
  it.** The goal is immutable — `AgentStatePatch` cannot name it.
  `requirements` are outcomes, `constraints` are what the user's words forbid
  (`exclude`), confine (`scope`) or bound (`limit`), and `plan` records the
  version, the highest id ever issued, the newest user answer reconciled and
  each amendment. A new entry's `source` is required, must quote the goal or a
  user answer (`agentQuotes`), and must name something the entry names; an
  entry with no quote, a fabricated one, or a genuine but unrelated one is
  refused, so an outcome nobody asked for cannot enter dressed as one
  somebody did.
- **Required reading is work, not a disposable hint.** An initial bare
  review/read instruction misclassified as a change is retained as a read
  requirement. The same instruction misclassified as an unbounded constraint
  is moved to a read requirement with its source intact; actual limits and
  prohibitions stay constraints. Compound reading/action instructions keep
  their words and kind. This preserves the obligation, not proof of traversal
  coverage or prerequisite ordering: a visit alone does not establish review,
  and the existing grounded-evidence and completion rules still apply.
- **Explicit assignments keep their target.** Named-value coverage retains
  the control in English `set … to …` instructions, checks the assignment
  within one requirement, and does not merge identical values requested for
  different controls. A new field/selection check contradicting an explicit
  assignment in the original user message (or goal when unavailable) and
  latest user answers is refused for repair; model-authored source text
  cannot override those values. Quoted literals keep their
  punctuation and short codes; ambiguous unquoted punctuation prefixes use
  value coverage without claiming a complete control/value binding. These
  bounded rules are not a general semantic parser or a guarantee that every
  requested relationship has been understood.
- Named literal action values must appear in affirmative requirements, not
  solely in constraints. A field/selection check covers only its own literal
  value; mentioning another value in the same requirement's text does not make
  that value checked. The bounded English command rules also recognize quoted
  action values. Ambiguous punctuation prefixes and selection criteria retain
  their previous coverage handling; this is not a general language parser.
- Planning instructions distinguish leaving a draft from asking the site to
  store it: a no-submit boundary alone must not invent a save operation, saved
  predicate or persistence obligation. Explicitly requested saved work still
  uses the existing persistence and readback checks.
  Initial-plan normalization likewise ignores a model-invented `persist` flag
  on a standing draft instruction when its user source does not ask for storage,
  submission is already forbidden, and other work remains. Storage cues in the
  user's own request preserve the obligation; delegated goal wording cannot
  override the original user message. Kept requirements are not removed this way.
- **A plain price cap is conditional.** Initial constraints quoting a supported
  user cap such as “don't book anything over 120 credits a night” retain that
  exact bound as a limit, without model-invented blanket payment/submission
  bans. Native clause recovery makes the same distinction, including cents.
  Explicit independent bans and prior constraints retain their forbidden
  classes. Unsupported conditions keep the conservative prohibition. Price
  permission itself comes only from the runtime's control-bound terms check;
  the planner cannot provide amount evidence. See the policy contract.
- **A read-first phase precedes resolved edits and commits.** A read marked
  `beforeChanges` is a run-wide prerequisite, not a step number or a dependency
  on one later action. New planner flags must match an explicit ordering clause
  in user text; unsupported flags are refused for repair, without dropping the
  reading obligation. A bounded English rule retains explicit
  `read/review/inspect/compare/check/verify/look up … then/before fill/type/enter/…`
  clauses when their subject matches the read, even if the planner omits the
  flag. A read classified as a checkbox change cannot become a read phase.
  Independent reading is not ordered by array position. Kept reads retain the
  flag. This recognizer does not establish arbitrary semantic or multilingual
  dependency correctness.
  Before policy or execution, resolved form mutations, drags and consequential
  effects require `prerequisiteOutcomes` for the unfinished read phase. The
  existing completion judge checks those answers, including per-source coverage,
  and the existing bounded reviewer may resolve semantic uncertainty. Missing,
  stale, visual-only, merely claimed or unsupported answers cannot release it;
  workflow `supported` is not satisfaction. Navigation and inspection remain
  available. Unknown effects remain subject to the existing effect classifier
  and policy; this is not a general semantic dependency graph.
- **A committed choice can depend on a read without ordering every edit.**
  On a change, `requires` names read requirement ids. The planner supplies the
  exact text of reads in its proposal; the parser resolves them to runtime ids.
  Unknown, ambiguous, change-to-change and read-to-read references are refused.
  A kept change retains its dependencies and merges any the amendment adds
  (an unresolvable one is refused, never dropped); only a user-confirmed
  removal of the read releases its edge. A kept read keeps `beforeChanges`
  and may gain it when the user's own words ground the ordering; an
  amendment that changes only `freshness` or `beforeChanges` is versioned.
  A kept read keeps its stored words; a restatement that adds words to it is
  refused, so a dependency cannot resolve to scope the read never stored.
  Ordering omitted by the planner is recovered from the user's words for
  every read of a first plan and for reads an amendment adds. The dependency survives storage and is projected to
  the actor. Plan amendments that add dependencies invalidate old read proofs
  through the existing version check.
  A comparison feeding a committed choice (for example, compare linked candidates
  and book the cheapest eligible one) should use this field even without an
  explicit “then.” The planner still owns semantic dependency discovery; the
  schema cannot prove that it found every necessary edge.
  Before consequential effects, the existing read judge and bounded reviewer
  must establish the dependent reads. Preparatory field mutations and navigation
  remain possible unless `beforeChanges` separately forbids them. A command tag
  cannot prove semantic independence, so the current gate conservatively owes
  **all** commit dependencies on every consequential effect, including untagged
  effects or those tagged to another outcome. This may hold an unrelated commit;
  it does not yet provide semantic effect-to-outcome binding. One narrow
  exception keeps a plan such as "submit a quote request, read the returned
  quote, accept it" reachable, bound to the control rather than the tag: the
  step is tagged to a change listed before the read that does not itself
  require it, carries no `beforeChanges` and has not yet attempted a commit,
  and the control's runtime-resolved accessible name uses a word of that
  change's own action that no dependent change uses and none of a dependent
  change's own words. An "Accept" tagged to the submit, an unnamed control, a
  label both changes share, untagged steps, the dependent change, a change's
  second commit and steps with unknown history still owe every dependency.
  A durable read proof records a versioned digest of each answer the runtime accepted.
  Unversioned digests still load, but their answers are judged again because
  the older format folded case and omitted some top-level statements.
  A later outcome keeps the proof's authority only by restating that same
  answer, top-level statement and items alike (whitespace aside, letter case
  kept); an outcome that
  states no answer, a changed answer or selection that reuses the proof's
  quotation, and a proof without a recorded digest are all judged again, and a
  computed comparison always runs. Missing restored
  references refuse a commit. Consent, effect uncertainty and duplicate guards
  still apply after prerequisite proof. Booking action labels naming an offer,
  room, flight, reservation or number of nights add potential-commit status
  to script activations; navigation labels such as “Book details” do not.
  Unrecognized effect semantics remain a classifier limitation, not proof that
  an activation is harmless.
  Counted linked collections such as “three offers linked on this page” use the
  existing starting-page source enumeration, with a matching count as well as
  complete, unambiguous links. A missing source, partial observation, offscreen
  link, pagination or ambiguous address leaves coverage unknown. Source names
  and URLs remain untrusted data and cannot authorize new work. This bounded
  English recognizer does not establish arbitrary collection semantics.
- **Read-phase proof survives without becoming effect proof.** After the reads
  pass, the planned step records `readPrerequisites` with the plan version,
  requirement ids, original supported tiers and an optional digest of each
  accepted answer, alongside the retained evidence. Under a price limit, an
  itemized read with every item answered also keeps its accepted per-item
  quotes (one table of at most twelve rows per receipt), so a later priced
  step that omits the comparison computes it again from those quotes after
  grounding each against the retained ledger; a later proof without a table,
  a new plan version or an unretained quote leaves nothing selected. The
  digest field is optional in the strict receipt schema: receipts written
  without it still parse and still prove the read happened for later writes,
  but final reporting can reuse the read judgment only for an answer whose
  digest the receipt holds. Subsequent writes can use that historical read
  judgment without rereading an authored destination. A new plan version invalidates its
  reuse. The receipt says nothing about delivery, save, persistence or uncertain
  effects, and cannot authorize a replay. Explicitly unmet final answers stay
  unmet. Legacy plans without read-phase flags or dependency edges keep their existing behavior.
- Multi-source decision instructions ask for identity, value, units and relevant
  eligibility in source quotations before leaving a document. A bare value
  retained without its source identity cannot be repaired by adding a name at
  the destination or joining unrelated documents. These remain model-supplied
  quotations checked against authorized observations; the instructions do not
  manufacture provenance or weaken the prerequisite and completion judges.
- Multi-page review instructions likewise ask for each page's identity and
  relevant content before leaving it. Reaching the last page does not establish
  review coverage; repeated extraction of that page cannot recover missing
  earlier evidence. A heading alone does not prove a substantive review.
- **A record a step is about is read off its row.** `agentRequirementRecords`
  names what an outcome is about: its items and its check's record. A step
  whose control sits in a row naming another planned record and not its own
  is refused before policy (`agentWrongRowRecord`) — the "Mark paid" on
  Invoice A's row for a step about Invoice B. A `scope` limit ("keep every
  other invoice") is proven for a consequential step only when the control's
  row names exactly one of its requirement's records; without that it still
  refuses. A row that merely fails to repeat the record's wording is never
  refused, only one naming a different planned record.
- **A check-less outcome binds to the control, not only the tag.** A receipt
  the model tagged with a requirement id binds to a requirement with no check
  only when the control it acted on shares a content word with it. A
  `fill_form` field named by the last word of a qualified name ("Address" for
  "Billing address") binds when that word picks out one field on the page.
- **An id keeps its meaning.** `keep` is honoured only for an entry that
  reads like the one it names, and an entry restated word for word keeps its
  id unasked — otherwise a planner that forgot `keep` put the same outcome in
  the plan twice and the run could never answer both. Receipts bound to `r1`
  must keep meaning the `r1` they were bound to.
- **Over the cap is refused whole, never sliced.** More than
  `MAX_AGENT_REQUIREMENTS` entries, or more items than the item caps, is
  `AgentPlanOverCapError` naming its unit (outcomes, items or constraints)
  and bound; the port retries once with feedback asking for repeated
  outcomes to become one requirement with `items`, and a second over-cap
  answer becomes `overCap` — a question naming that unit, asked before the
  first look. An over-cap amendment asks the same question while retaining
  the plan and leaving the user's answer unreconciled. When an amendment
  proposes removals to make room, ask only about removals relevant to the
  exceeded caps, and only when the projected whole plan fits after them.
  Confirming them must leave the original additions outstanding for the next
  planning call. A follow-up may propose removing an inherited constraint by
  its previousRun id. An initial capacity-removal plan retains the inherited
  limits, asks before observing, and leaves reconciliation unset until the
  follow-up goal and answers fit; confirmation then replans the whole goal.
  An itemized requirement is answered item by item in
  `outcomes[].items` and judged per item, each on its own quotation or its
  own verified change; one invoice's evidence never vouches for the rest. An
  item's quotation must name that item as a whole phrase and may not repeat
  another item's; for a change it must start at the item's name, carry a
  state after it, and name no other item ("Paid Invoice 2" and "Invoice 1
  Due Invoice 2 Paid" each quote the wrong item's state). Items themselves
  must be rows the user named — whole phrases of the original user message
  or an answer (the caller goal only when no user message is available) — so
  names introduced by the chat assistant are not user-named items, and
  "all nine invoices" is one outcome, not nine invented rows. A lone item
  that describes rows instead of naming one (a determiner or count first, a
  relation word, more than four words) is folded into the requirement's
  text: no page writes "the two flights listed on this page", so it could
  never be quoted. A read answered more than once for one item was
  itemized along the wrong axis (each shop's price, planned as the one
  product) and goes to review once its quotations are grounded, since the
  last answer would otherwise stand for all of them. A receipt stands in for an
  item only when its target, row, or — for a verified batch — one of its
  checked fields names the item; every item shares the requirement's id.
  If the item extends a control's name with a value or state, the confirmed
  result must prove those added words too; a checked Given name control
  does not prove the item Given name Ada.
  A planner `clarification` is asked the same way; a `limitation` fails the
  run as `goal_failed` in the planner's words.
- **A numeric limit keeps what the user said it bounds.** A new constraint
  sourced from a bound ("under 90 credits") that changes its operator or adds words the user's
  own clause lacks, drops a qualifier, or changes an amount is replaced by
  the user's clause from its source
  (`userLimitClause`). A total, a budget, a per-item cap and a usage cost are
  different limits; a chat goal that wrote "keep total research spend under
  90 credits" for "stay under 90 credits" once made the reviewer sum four
  listed prices into a spend and the actor invent a research cost. The
  replacement keeps the limit exactly as underspecified as the user left it;
  it never chooses a reading. A restatement adding only bound phrasing or the
  same clause's own words is kept, and a kept entry keeps its words.
  Comparison operators and qualifier order are preserved. Words from other
  clauses cannot supply its quantifier or budget object,
  and qualifiers at the end of a long clause are preserved. A source that
  quotes multiple numeric bounds requests the existing bounded plan repair
  with a separate source clause for each; it never picks one arbitrarily.
- **Negative clauses are found by rule as well as by the model.**
  `agentGoalBoundaries` reads "don't / without / never", "only the …",
  "under $N" and draft phrasings from the user's words and adds any the plan
  left out as constraints. `forbids` — the consequential effect classes a
  constraint rules out — comes from a verb in the negation's own
  sentence, and the planner may name further classes on an entry that quotes
  the user's words — it adds, never removes, and a kept entry keeps what it
  forbade; two clauses are two prohibitions even when
  they open alike. Broad cues ("no", "nothing gets", "stop before") count
  only when their sentence names an effect. The whole sentence is read and no
  condition lifts it: "don't submit until I say so" means not now, and a
  draft never sends. The one cut is a new command — ", and", ", then",
  ", but" followed by a consequential verb, directly or after words like
  "you can" or "please", with no list before it and no negation after it —
  so "don't delete the file, and (you can) send me the receipt" still sends, while "…, and you won't submit" still forbids. Reading too much forbids too much, which costs a
  refusal and a question; reading too little let a forbidden effect through.
  The controller refuses a command whose resolved effect carries a forbidden
  class before policy is asked. A follow-up inherits the parent's
  boundaries (`previousRun.constraints`), including scopes and numeric
  limits, because its goal is usually the chat model's words.
- **Only the user's words amend a plan, and only the user's yes removes
  anything.** An answer, correction or steer newer than
  `plan.reconciledThrough` triggers one planning call, given the goal, the
  answers and the plan in force — never an observation, finding or step.
  Kept entries keep their ids **and their words** (a kept constraint keeps
  what it forbids, a kept requirement its items); a reworded `keep` quoting
  the newest answer is new work under a new id. New ids take the next
  number after `plan.issued`. The amendment rides the deciding claim, and a
  change bumps `plan.version` and stamps `since`.
- **Removal is a question, never a reading.** What an amendment would drop —
  an entry, or one item of a requirement — comes back as
  `proposedRemovals`; the plan keeps everything, records it in
  `plan.pending` with a question id, and the run asks the user by naming the
  plan's own entries. Only a plain yes to that question removes them; the
  localized yes/no words shown in all nine locales are accepted, preserving
  their accents and combining marks. A no,
  or any sentence, keeps everything (a sentence is then read by the planner
  like any other answer). Lifting a prohibition — a constraint that forbids
  an effect — is asked on its own, as a limit that would no longer apply,
  and only "allow" lifts it: a "yes" there reads as well as "yes, don't". Every rule tried for telling a withdrawal from a
  mention — cues, negations, clauses — was one phrasing short, and its
  failure was requested work silently gone. Nothing removes the last
  outcome.
- **An unread answer holds back what cannot be undone.** When the planner
  fails, the port amends by rule (`agentRuleAmendment`: the plan in force
  plus every clause found in the newest answers). That plan is
  `provisional`: its limits apply at once, but the answer stays
  unreconciled, and while any answer is unreconciled the controller refuses
  every consequential effect and every completion. The next decision asks
  the planner again. A planner that never recovers ends the run on its
  budget, not on a guess.
- `agent-useful-workflows.spec.ts` exercises composer lookup, long editing, pane scrolling,
  paginated extraction, clarification, delayed save and native confirmation.
  Its hosted flag also runs these tasks against a real provider. Scripted
  results establish execution coverage, not live-model reliability. Set
  `AGENT_HOSTED_WIRE=ollama` for native Ollama; the default is OpenAI-compatible.
- The panel debug report uses its existing authenticated supervision port.
  Features never import background repositories. Store checks scan every JS
  bundle for debug helpers regardless of the caller's environment flags.
