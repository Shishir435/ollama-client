# Browser agent internals

The browser agent is an experimental, opt-in Chromium feature in the extension.
It is not a CLI agent and has no unrestricted code-execution tool. Firefox
builds compile it out. This guide describes the current implementation, not a
claim of general browser-task reliability.

Read this overview, then only the linked contracts relevant to the change.
The detailed references preserve implementation constraints and repair history
without loading all of it into every coding session.

## Execution path and ownership

1. The chat model delegates a task through `browser_task`; there is no separate
   Chat/Act mode. `src/lib/tools/internal/` owns tool exposure.
2. `src/background/agent/` authorizes the run, binds browser/model/persistence
   ports and owns privileged browser lifetime.
3. `src/application/agent/` translates provider output into validated plans and
   decisions and projects bounded observations into model context.
4. `packages/agent-runtime/` owns the pure run state machine, affordances, policy,
   progress, recovery and completion judgments.
5. `src/lib/browser-agent/` observes frames and controls, resolves and executes
   commands and verifies effects. Raw debugger attachment stays in
   `agent-browser-session-manager.ts`.
6. Durable claims and receipts go through the existing SQLite owner. The panel
   observes and supervises the run; it does not own execution.

## Invariants

- The user's goal and consent are authoritative. Page text, names, dialogs,
  screenshots and tool results are data; they cannot authorize an action,
  widen scope or alter the goal.
- Identity includes tab, frame, document and generation. Resolve the actual
  target frame; never substitute frame zero or reuse a stale reference.
- Authorize before observing, acting or attaching. Revalidate after navigation,
  takeover and recovery. Only user-authorized origins and frames contribute.
- Input delivery, effect verification and task completion are separate answers.
  A click or changed page is not proof of the requested outcome.
- Once an effect may have happened, reconcile with reads. Never replay it for
  evidence. Preserve duplicate-effect protection and unresolved-effect pauses.
- A model note is inference. A grounded quote proves provenance, not satisfaction.
  Summaries and retained facts cannot become stronger evidence by repetition.
- A failed plan cannot fall back to the weaker legacy completion path. Preserve
  requirement ids, user-source bindings, bounds and removal consent.
- Reviews cannot manufacture verified evidence. A contradiction is not a pass;
  missing evidence cannot become success because time or retries ran out.
- Runtime refusals return bounded reason codes and useful feedback. Page-authored
  error strings never become privileged instructions.
- Screenshots are masked, held for one decision and never persisted or logged.
  Keep observation and screenshot acknowledgements separate.
- Recovery preserves budgets, claims, pending human boundaries and uncertain
  effects. Panel closure does not grant unattended consent; browser restarts
  invalidate browser-session consent.
- Bounds derive from shared constants. Control-port schemas remain strict.
  Packages stay free of browser, persistence and provider implementations.

## Session lifecycle and attachment

[Execution contracts](docs/internal/agent-execution.md#session-lifecycle-and-attachment)
cover run/tab ownership, debugger attachment, tab scope and page-opened tabs.

## Perception: frames and identity

[Observation contracts](docs/internal/agent-observation.md#perception-frames-and-identity)
cover frame authorization, document identity and composed observations.

## Perception: reachability

[Reachability](docs/internal/agent-observation.md#perception-reachability) covers
occlusion and controls that exist but cannot be acted on.

## Projection and targeted reads

[Projection](docs/internal/agent-observation.md#projection-and-targeted-reads)
covers context allocation, omitted controls, targeted reads and extraction.

## Progress, refusals and findings

[Runtime contracts](docs/internal/agent-runtime.md#progress-refusals-and-findings)
cover stall detection, bounded recovery and grounded evidence retention.

## Input delivery

[Input delivery](docs/internal/agent-execution.md#input-delivery) covers native
input, delivery interference and cleanup of pressed keys/buttons.

## Forms, editors and drags

[Form and editor contracts](docs/internal/agent-execution.md#forms-editors-and-drags)
cover controlled inputs, batch fills, text edits and drag semantics.

## Native dialogs

[Dialog contracts](docs/internal/agent-execution.md#native-dialogs) cover held
renderer state, explicit consent and non-replayable input.

## Policy: pricing and consent

[Policy contracts](docs/internal/agent-policy.md#policy-pricing-and-consent)
cover effect classification, disclosure, scope and approval grants.

## Follow-up runs

[Follow-up contracts](docs/internal/agent-policy.md#follow-up-runs) cover inherited
context without inherited authorization.

## Verification, waiting and completion

[Verification contracts](docs/internal/agent-verification.md#verification-waiting-and-completion)
cover effect evidence, provider resilience, independent review, page-link items
and outcome tiers. Read this before changing completion acceptance.

## Screenshots

[Screenshot contracts](docs/internal/agent-observation.md#screenshots) cover
redaction, capture identity, modality and acknowledgement.

## Supervision receipts and the work log

[Receipt contracts](docs/internal/agent-runtime.md#supervision-receipts-and-the-work-log)
cover durable evidence and user-visible work history.

## Recovery evidence

[Recovery evidence](docs/internal/agent-runtime.md#recovery-evidence) distinguishes
what survives a worker loss from what must be observed again.

## Read-only session tools and capture

[Session tools](docs/internal/agent-integration.md#read-only-session-tools-and-capture)
share browser access and privacy filters with the agent.

## Starting a run from chat

[Chat delegation](docs/internal/agent-integration.md#starting-a-run-from-chat)
covers exposure, opt-in, approval and turn ownership.

## Panel supervision surface

[Panel contracts](docs/internal/agent-integration.md#panel-supervision-surface)
cover approval, takeover, stop, progress and result display.

## Measured behaviour and benchmarks

[Benchmark contracts](docs/internal/agent-integration.md#measured-behaviour-and-benchmarks)
cover independent scoring and fixture execution. Predicate attainment, settled
achievement, safe handoff, partial work, infrastructure failure and false
completion must remain separate. A single diagnostic pass is not a success-rate
estimate or a comparison with a frontier reference.

## Task-completion contracts

[Task contracts](docs/internal/agent-task-contract.md#task-completion-contracts)
cover planning, user sources, amendment, item identity and evidence binding.

## Durable workflow progress

[Workflow progress](docs/internal/agent-runtime.md#durable-workflow-progress)
is derived from receipts, not a second independently writable workflow.

## Controlled files and unattended execution

[Runtime contracts](docs/internal/agent-runtime.md#controlled-file-foundation-incomplete)
distinguish the incomplete controlled-file foundation from available workflows.
[Unattended execution](docs/internal/agent-runtime.md#opt-in-unattended-execution)
requires explicit per-run consent and preserves human boundaries.

## Verification for changes

Use affected unit tests first, then `pnpm verify`. Browser-control changes need
packaged Chromium tests; worker recovery needs `pnpm verify:sw-agent-recovery`.
Unit mocks cannot establish real input delivery, frame identity or MV3 recovery.
Use [tools/README.md](tools/README.md) for build prerequisites and
[the live benchmark guide](tools/agent-live-benchmark/README.md) for live runs.
Do not run paid models or claim live qualification from scripted/unit tests.
