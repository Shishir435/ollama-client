# Browser agent: integration

Detailed implementation contracts. Start with [AGENT_INTERNALS.md](../../AGENT_INTERNALS.md) and read only the sections relevant to the change. Repair history explains existing behavior; it is not evidence of live-model reliability.

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
- **The start is asked about once per chat, and always when it could be
  carrying page text.** The tool is `medium` risk with
  `sessionGrantScope: "chat"`: "Allow for this chat" is keyed by chat and
  tool alone, kept in `chrome.storage.session` so a worker restart keeps it,
  and neither the site nor a later page read withdraws it — the forced
  prompt below is what stands in for both. `confirmation` forces the prompt,
  whatever grant exists, when the turn's context carried something read off a
  page (an attached tab or file, retrieved documents, a previous run's record,
  in this turn or anywhere earlier in the history the model reads:
  `pageContentInContext`), when a tool result advanced `taintGeneration`,
  when the model named another tab, when the model's tool calling is only the
  user's override, and when a remote provider's notice has not been
  acknowledged. The prompt shows the goal as plain text and the notices as
  keys; approving it is the acknowledgement those notices ask for.
- **The user's own message rides beside the goal.** The durable turn carries
  what the user typed, before any retrieved context was joined to it, as
  `userUtterance`; `browser_task` hands it to the run, bounded at
  `MAX_AGENT_UTTERANCE_CHARS` with its whole length recorded. The planner
  may quote it, its limits are read by rule like the goal's, and each
  plan entry records whether it rests on
  the user's words (`origin: "user"`) or only the chat model's goal
  (`"delegated"`). It is not authored text for the egress rule: a message
  can carry a selection the user added from a page, and exempting that from
  the provenance check is the approvals work's to decide. A value the message names — in quotation marks, or as the
  object of select, choose, pick, enter, type, tick, toggle, switch or set …
  to — that no planned outcome, item, check or limit mentions is refused
  once with the values named; missed again, each becomes a requirement of
  its own (`origin: "coverage"`). The planner may name a value in
  `notForBrowser` when the message asks for it in chat rather than in the
  browser ("explain what 'event loop' means"); only a value it names is set
  aside, never one it merely left out. A goal over `MAX_GOAL_CHARS` is a tool
  error, never cut: cutting removed the limit the user put last.
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
  names the same call id, finds the run it already started (`delegate` looks
  it up by row and compares `toolCallId`) and waits on it again. A different
  call in the same turn is refused (`turn_has_run`) rather than handed the
  first run's record, which would report a task that never started.
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
- **Pause and Stop cannot lose to the loop.** `requestPause` and
  `requestCancel` compare-and-set from the status they read, and the loop
  moves the run several times a step, so a stale read used to fail silently
  and the run carried on. `commitStop` rereads and retries until the write
  lands or the run is terminal, already pausing or stopping; the abort still
  follows the committed write, never precedes it. A stop that still cannot
  land throws, so the panel reports a failed command instead of a silent
  no-op. A committing-label approval offers no standing grant, since none
  would ever cover it.
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
