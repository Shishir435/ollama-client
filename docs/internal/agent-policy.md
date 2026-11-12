# Browser agent: policy

Detailed implementation contracts. Start with [AGENT_INTERNALS.md](../../AGENT_INTERNALS.md) and read only the sections relevant to the change. Repair history explains existing behavior; it is not evidence of live-model reliability.

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
- **An unresolved effect has two ways out.** "I've reviewed the page —
  continue" re-observes and decides again; "It's done — finish"
  (`agent_finish_reviewed`) completes the run on the user's word, the one
  `paused → completed` edge, with a fixed result saying the user confirmed
  it. Both name the pause they answer, so a stale panel resolves nothing.
- **A browser page is no place to start; a named site is.** From a tab the
  agent cannot drive (`brave://extensions`, the new-tab page) `browser_task`
  refuses and tells the model to pass `start_url`. With one, the start is
  approved against that address's origin and the site opens in a new tab
  only after the approval. A usable tab in view keeps the run when it is
  already on that site or the model named it; on another site it does not,
  because starting there made "open Google and search…" cost a second
  approval to leave the page for the site the first one already named.
- **A run never navigates the user's own tab to another site.** The first
  tab in a run's scope is the page the user was on; a `navigate` from it to
  another origin runs as `open_tab` (`user-tab.ts`), with the same
  destination and approval. Same-origin moves and tabs the run opened are
  unchanged. A navigation counts as landed when the committed URL keeps the
  requested origin, path and every requested parameter — a site adding
  `&ia=web` on arrival is not another destination. A GET submission is
  recorded and verified by its visible fields only: the executor loads the
  full address but reports it without the form's hidden inputs, which a site
  may drop on arrival and which stay out of the record. A missing search
  term is still another destination.
- **Routine consent follows a site only when the approval says so.** An
  approval to open a new site, in a run given routine consent, names the
  site as `routineOrigin` and adds the sentence that clicks and typing there
  will not ask; approving it writes the grant. Submissions never carry it.
- **A search-box textarea submits on Enter like an input.** DuckDuckGo and
  Google render their search field as `<textarea name="q">`. Enter there is
  a submission when the textarea says it is one line (`rows="1"`, a
  combobox or searchbox role, `enterkeyhint="search"`, never
  `aria-multiline`), is the form's only text entry, and sits in a GET form
  with a submitter; anywhere else it stays a newline.
- **Enter in a same-origin search shows the address it opens, and stays a
  submission.** A GET form can change state through its handler or its
  endpoint, so Enter is priced, granted and verified as a submission; a
  routine grant never covers it. The one consent that does is the start
  prompt's search grant on the starting site (below), and only for a form
  the page marks as a search. What the observation adds is `formQuery`,
  the query the executor's guarded copy would send, so the approval's
  "complete destination URL" carries the `?q=` it used to be missing. It is
  offered only when every contributing control is non-sensitive and rendered
  and the form holds no hidden input at all — named or not, enabled or not —
  because hidden values never cross the control port and a `display:none`
  field is a hidden field by another name. The query is built by one helper
  shared with the guarded submission (`form-submission.ts`), in its order,
  and the executor refuses a submission whose live query differs from the
  approved one: the form fingerprint compares selected options, not every
  option's value, so it alone could not hold the address still. It checks
  twice — before the page's submit handlers, as a clean refusal, and on the
  guarded copy about to be sent, after them, where a mismatch sends nothing
  but is an unresolved effect, because the handlers' own code already ran.
  The checked address is then loaded with `location.assign`, never through a
  native submission: that fires a bubbling `formdata` event after every
  check, and a document listener could rewrite the entry list in it. Only an
  `http(s)` address is loaded. POST keeps the native submission, since its
  body is not shown as an address.
- **Routine-action consent is a preference each run mints grants from.**
  `AGENT_PERMISSION_MODE` (device-local, "allow on the starting site" by
  default) is read once per start; `allow_routine` makes the background create
  only activation and form-mutation grants (`AGENT_ROUTINE_GRANT_EFFECTS`,
  deliberately narrower than `AGENT_GRANTABLE_EFFECTS`) for the starting
  origin in that run, and `approve_each` keeps per-step review. A remembered
  preference is not a carried grant: changing it never widens a run already
  going. What a chat carries is its runs' routine grants
  (`agent-chat-consent.ts`, `chrome.storage.session`): clicks, typing and
  search consent per site, merged into the next run's grants in the same
  chat. A carried grant adds no site to the allowlist, never carries a
  widened submission, and is not carried into a `model_after_page` goal.
  Destruction, new
  origins, sensitive controls and buttons labelled as committing retain
  their own gates — a submission is
  widened only from an approval the user was shown, never in advance from a
  setting. The `browser_task` start prompt is such an approval: under
  `allow_routine` it carries `agent.start_gate.routine`, saying searches on
  the starting site will not ask, and the starting grant then carries
  `searches` (`allowSearches`). A search the user asked for is one decision,
  not three.
  - A search is a GET submission from a form the page marks as one
    (`searchForm`): its one text field is a search box (`type="search"`, a
    searchbox or combobox role, `enterkeyhint="search"`) or the form is a
    search landmark, and every other control is a button, a hidden input or
    an empty file picker. Google's form carries both. Hidden values are not
    shown, deliberately: they go back only to the origin that wrote them, and
    `matchesFormState` refuses a send if any of them changed since the
    observation, so they add nothing the page's own script could not already
    send. Refusing them would make every real Google search ask. A query string
    alone is not enough — a preferences form's "Apply" sends one — and a
    POST, a form with a select, checkbox or second field, or a sensitive
    form still asks. The `submission` effect itself is never pre-granted.
    `searchForm` is approval evidence and is stripped from the wire target by `wireTarget`, the one helper every instruction's targets go through — a batch fill once kept its own copy of the strip list, missed `searchForm`, and paused every `fill_form` on a search box as unresolved.
  - The consent comes from the prompt the user answered, read through
    `ToolContext.confirmedNotes`, and the mode must still allow it at start:
    a setting changed while the prompt was open narrows the run, never
    widens it. A start covered by an earlier grant showed no prompt and gets
    no search consent.
  - Never for a `model_after_page` goal, whose searches a page may have
    written.

  The preference replaced a per-task checkbox that reset to
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
  words: the goal, the user's own message (unless it holds a quoted line,
  which is how a page selection arrives), the user's answers — never the
  question the model asked — and the text it typed or selected on its own
  durable receipts (never `replace_text.find`, which is a quotation of what
  the page already held). The same words exempt a search from the
  visible-text escalation when the page merely echoes them. Every long span of the URL must be
  accounted for by those words, containment one way only, or the block
  stands; no authored words at all is no claim, and the rule stays as strict
  as it was. The destination raises are untouched, so a model-composed URL
  with a query is still `high` and the user still sees the whole URL. The
  honest limit: a value the run typed is its own, so a model that copies a
  field value into a box and then navigates with it is stopped by that
  approval rather than by this rule.
- **A button labelled as committing is asked about every time.** A script
  "Place order", "Send" or "Transfer" carries no form submitter, so it
  resolves to a plain activation that routine consent would cover. The
  resolver marks such a target `committingLabel` from its accessible name
  (nine locales, whole words), and policy never covers it with a grant.
  Raise-only: a miss changes nothing, a false match costs one prompt. The
  click is also recorded as the consequential class `potential_commit`, so
  its receipt, the repeat guard, recovery and constraints see it: a
  constraint forbidding a submission or a payment forbids it.
- **Conditional money caps need current control-bound displayed terms.** A plain
  supported clause such as “don't book anything over 120 credits a night” remains
  a limit; it is not a blanket prohibition on booking or payment. Initial-plan
  normalization ignores model-invented forbidden classes on that exact,
  user-sourced cap. Separate bans, retained constraints and qualified or
  unparsed prohibitions keep their existing enforcement.
  The browser can bind a sole rendered offer heading and complete bounded terms
  to its action, within the same frame and record container. Multiple headings,
  competing controls, variable quantity/variant controls, incomplete text or an
  unknown scope withhold the binding. Currently only simple English labelled
  nightly/daily/unit rates or an explicit total in credits, USD, EUR or GBP are
  understood. Currency and basis must match; there is no exchange conversion or
  inference of a total from a rate. A per-unit action must explicitly name a
  fixed count matching the user's source. Extra charges, qualified rates and
  multiple prices are unknown. This is deliberately a bounded recognizer, not
  a general price or checkout parser.
  Monetary limits without these terms refuse submissions and possible commits,
  as well as the existing payment-bound refusal. Model quotes or claims cannot
  supply the binding. Supported within-cap terms release only this check:
  prerequisite evidence, consent and payment takeover policy still apply.
  The approval shows the terms as untrusted page evidence. The control port
  carries them, and dispatch re-reads and compares them before sending input;
  changed prices, identity or quantity controls mean the effect was not applied.
  This checks displayed offer terms, not the server's honesty or an actual
  charge, and creates no completion or persistence evidence. When no supported
  terms exist, feedback directs the actor to ask for help rather than retry the
  same control without changed evidence.
- **A script "Save" is recorded so its repeat is caught.** `savingLabel`
  (Save, Update, Mark as paid; nine locales) makes the click a `save`: the
  first press stays covered by routine consent, a second press of the same
  control asks as a repeat, and no constraint forbids it.
- **The repeat guard knows which record it touched.** A prior effect keeps
  its row (`row`, the row context minus the control's label). Two rows are
  different records only when both lead with an identifier, the leads
  differ, and they share none: an id mixing letters and digits ("INV-001"),
  a lone capital ("Invoice A"), or a bare number that leads the row or is
  marked `#`. A bare number anywhere else is a balance or a count and never
  names a record, so "Balance 120 Due" / "Balance 0 Paid" stays one record,
  and so does "Record 5" / "Record 6" (it asks). Amounts, times and
  quantities with units never count. A row with no identifier, or no row,
  keeps the coarse match. A list that renumbers on change loses only the
  repeat notice.
- **Browse mode: a read-only plan asks for almost nothing.** When every
  requirement is a read (`agentPlanIsReadOnly`), policy (`browseAllows`)
  lets navigation to any http(s) site, search forms, search boxes, filters
  outside posting forms, links and non-keeping buttons through, and the
  sites reached join the allowlist (`authorization.browse`). Posting forms,
  typing elsewhere, committing or keeping labels, sensitive controls,
  critical effects, other tabs and unknown frames still ask. A URL the model
  composed for a site not yet allowed must be made of the user's or the
  run's own words (`userWroteDestination`), whatever page the rest came
  from — the check is authorship, not what the current page shows.
- **Approvals show values.** `values` on the request lists what a step
  types or selects, every field of a batch, or — for a submission — every
  control the form will send (`effect.submitted`, resolver-side, never on
  the wire). Sensitive values are withheld. A value the plan's field,
  checkbox or selection check disagrees with carries `planned`.
- **Plan consent (`follow_plan`) is opt-in.** The first step it would
  cover asks for the plan itself instead: the card lists the step's own
  outcome first, then the other changes, limits and reads
  (`planApprovalRequest`). Approving records the changes the card actually
  listed, word for word, in `planApproved` in the write that executes that
  step; a change the card could not fit, or one an amendment reworded, asks
  again on a card that lists it. Rejecting pauses the run with plan consent
  and the run's routine grants dropped. After that, a step bound to an
  approved change on an allowed site runs unasked; a submission or
  committing click only when the outcome's own text states a finished send,
  order or save (`COMMITTING_OUTCOME`, past forms only, since the bare ones
  double as nouns) — never the goal words it quotes, and never an outcome
  checked as a field, box or option, which is a fill. Repeats, critical effects, new
  sites and anything off the plan still ask. `model_after_page` goals never
  get it. A page shaped like an injection sets `injectionSuspected`
  durably, and from then on neither plan consent nor browse mode applies.
## Follow-up runs

- **A follow-up is a chat message.** A settled card offers Continue
  (completed, partial), Retry (failed, cancelled), Start over and Ask; each
  drafts a message in the chat composer that the user still sends, and the
  model decides whether the browser is needed again. A run it starts from
  there asks for approval like any other.
- **A card names its run; otherwise the background names the parent.**
  Continue and Retry draft the message with the card's run id beside it
  (`agentFollowUpRunId` on the turn — attached only when the message sent
  is still the drafted text, in the chat it was drafted in; Ask drafts
  nothing and clears it),
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
  grants, answers, requirements or origins. The parent's requirement ids reach
  the child's planner only as data it may keep an id from. `parentRunId` is written on the
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
