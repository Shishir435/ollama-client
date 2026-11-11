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
  cannot be done, not what is not done yet.
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
  never buy the weaker pre-requirements judge. A run paused or asked a
  question before its plan landed resumes into `planning`, never past it.
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
  must be rows the user named — whole phrases of the goal or an answer — so
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
