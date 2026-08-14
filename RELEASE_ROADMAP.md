# Release Roadmap

Last reviewed: 2026-08-14

This file tracks unfinished release and product work. Completed implementation
history belongs in the changelog and merged pull requests, while durable
repository rules remain in `AGENTS.md` and compatibility removal gates remain
authoritative in `compatibility-ledger.json`.

Release promotion follows one path: `release/*` → `preview` → `main`.
Release work merges into `preview` for validation; only `preview` merges into
`main`.

## Current status

| Version | Remaining work | Status |
| --- | --- | --- |
| `0.13.0` | Promote the verified `preview` release to `main` and publish the final artifacts | Release-ready |
| `0.13.1` | Make the extension more context-aware and intelligent while preserving supervised, local-first behavior | Next product phase |
| `0.13.x` | Maintain the completed runtime foundation and address only evidence-backed regressions | Maintenance |
| `0.14.x` | Build the supervised browser agent | Planned |
| Later | Remove compatibility paths only when ledger evidence permits | Evidence-gated |

The `0.13.0` runtime foundation is established in code: shared contracts,
deterministic runtime primitives, and turn/context/tool-loop orchestration live
in environment-independent workspace packages. Browser, provider, persistence,
and UI adapters remain in `src/`. Architecture contracts, runtime schemas,
restart tests, test-layout checks, and documentation-comment checks guard those
boundaries automatically.

## `0.13.0` architecture-audit closure

The architecture-audit release work is substantially complete. The `0.13.0`
gate requires no known Critical or High architecture findings, privileged
boundaries that reject invalid callers and payloads by construction, durable
lifecycle intent that survives worker loss, and measured growth/recovery
behavior rather than assumptions.

The implementation sequence and non-blocking follow-ups are complete. Their
history belongs in `CHANGELOG.md` and the merged pull requests rather than this
active roadmap. The only remaining `0.13.0` work is release promotion and
evidence on the exact commit that will be tagged.

### Release verification gate

Required automated gates:

```bash
pnpm typecheck
pnpm lint:check
pnpm check:dead
pnpm check:i18n
pnpm test:run
pnpm check:generated
pnpm check:compatibility
pnpm docs:build
pnpm build
pnpm build:firefox
pnpm verify:opfs-migration
pnpm verify:firefox-opfs-migration
pnpm e2e:chromium:critical
```

Required soak evidence on `preview`:

- Cold start, active-stream worker termination, stop during stream, stop during
  tool loop, approval wait, owner recreation, backup import interruption, and
  catalog-less provider scenarios pass on Chromium.
- Firefox MV2 validates persistent-background ownership, migration fallback,
  restart recovery, cancellation, and import/export.
- No duplicate provider call, terminal-state regression, stuck transaction,
  unbounded turn-row growth, raw sensitive logging, or unauthorized persistence
  request appears during soak.
- Diagnostics bundle records safe support evidence for owner startup,
  migration, durable recovery, and compaction without recording chat/page/file
  contents or credentials.

`0.13.0` may be promoted only when:

1. All Critical and High audit findings are fixed and regression-guarded.
2. Persistence and application RPC share equivalent sender, schema, timeout,
   cancellation, and safe-error rigor even if their transports remain separate.
3. Durable start, stop, resume, reconnect, and terminal transitions are
   idempotent under worker loss.
4. Terminal durable-state growth is bounded and measured.
5. Provider discovery has one policy owner.
6. Background composition exposes explicit readiness and dependency order.
7. Workspace package boundaries remain environment-independent.
8. Full Chrome/Firefox release gates and `preview` soak pass with recorded
   evidence.

The gate does **not** require eliminating every cleanup opportunity. Remaining
items need one clear owner, bounded risk, and regression protection where
practical; they are not release blockers without concrete failure evidence.

## `0.13.1` awareness and intelligence

With the runtime, persistence, provider, and recovery foundation established,
`0.13.1` shifts from architecture hardening to product intelligence. The goal
is an assistant that understands the user's intent and available context more
reliably without becoming silently autonomous.

### Context awareness

- Select relevant page, tab, file, knowledge, and conversation context with
  explicit source attribution.
- Avoid injecting unrelated context merely because it is available.
- Detect stale, missing, conflicting, or insufficient context and explain the
  limitation instead of guessing.
- Preserve local-first processing and existing privacy controls.

### Intelligent retrieval and memory

- Improve query classification, reformulation, retrieval routing, and fallback
  decisions using measurable evidence.
- Use memory only when it is relevant to the current intent, and keep the user
  in control of what is remembered or retrieved.
- Preserve provider/model/dimension identity through embedding and retrieval
  so intelligent routing cannot mix incompatible evidence.
- Surface why a source was selected when that explanation helps the user judge
  the answer.

### Capability-aware behavior

- Adapt prompts, tools, reasoning, vision, embeddings, and context budgets to
  verified model and provider capabilities.
- Prefer empirical evidence and user overrides over provider-name guesses.
- Degrade gracefully when a provider lacks model discovery, tools, vision, or
  embeddings.
- Keep external effects behind the existing policy and approval boundaries.

### Quality gates

- Measure retrieval relevance, context precision, grounded-answer quality,
  fallback frequency, latency, and local-model behavior.
- Add regression fixtures for context selection, memory relevance, conflicting
  sources, malformed embedding responses, and cancellation during retrieval.
- Treat intelligent behavior as a tested application policy, not additional
  logic embedded in React components or browser message handlers.

Non-goals for `0.13.1`:

- Hidden autonomous browsing or side effects.
- Unbounded background memory or prompt accumulation.
- Persisting hidden chain of thought.
- Provider-specific guesses presented as verified capability.
- A new agent framework before the supervised `0.14.x` phases.

## `0.14.x` browser-agent phases

### Product boundary

Ship one supervised browser agent first. Multi-agent remains a future extension
point, not initial runtime complexity. The agent operates through structured
observations, commands, policy, approval, execution, and verified effects.

Agent and chat may share contracts, model ports, tool primitives, and UI design
language. They do not share mutable stores, controllers, or feature internals.

### A0 — characterize and selectively port

- Treat `feature/agent-interaction-phase-1` as prior art only.
- Inventory code against current contracts and package boundaries.
- Port small reviewed slices; never merge the old branch wholesale.
- Keep the agent unreachable from production UI until safety and recovery gates
  pass.

### A1 — domain and controller skeleton

- Compile the user request into an explicit task specification, constraints,
  and completion criteria.
- Use deterministic states such as observing, deciding, awaiting approval,
  executing, verifying, paused, completed, and failed.
- Let the model propose typed decisions while the controller owns transitions.

### A2 — perception and command boundary

- Build bounded, ordered page snapshots with stable element references.
- Mark page content and tool output as untrusted.
- Start with navigate, click, type/replace, select, scroll, read, and wait.
- Never guess an unsafe target when binding is ambiguous.

### A3 — policy, approval, and execution

- Keep read-only observation distinct from effectful commands.
- Evaluate origin changes, sensitive fields, destructive effects, downloads,
  submissions, and user constraints in policy.
- Show the exact target, effect, origin, and relevant data before approval.
- Never let page text lower policy or approval requirements.

### A4 — effect verification and completion

- Treat successful API or DOM execution as insufficient proof of intended
  effect.
- Capture post-action evidence and compare it with expected effects.
- Detect navigation, DOM replacement, stale targets, and user interference.
- Let only the controller declare completion after criteria are verified.

### A5 — durability and UI

- Checkpoint at model, command, approval, execution, and verification
  boundaries.
- Resume safely after MV3 worker restart without repeating unverified effects.
- Provide pause, resume, stop, heartbeat, and redacted debug export.
- Separate conversation, work log, approvals, evidence, and final result in the
  UI.
- Preserve keyboard access and clear persistent running state.

### A6 — soak and compatibility

- Unit-test compiler, policy, reducer, verifier, redaction, and recovery.
- Contract-test model adapters, observation schemas, commands, and checkpoints.
- Cover forms, navigation, dynamic DOM, rich editors, prompt injection, stale
  targets, and restart recovery in browser fixtures.
- Measure task success, unsafe-action rate, unnecessary approvals, recovery,
  latency, token cost, and local-model behavior.

Initial non-goals:

- Autonomous multi-agent teams.
- Hidden chain-of-thought storage or display.
- CAPTCHA bypass, stealth automation, or approval bypass.
- Unsupervised purchases, account deletion, or broad external side effects.
- Native tab/session restoration without an interactive approval boundary.

## Compatibility track

Compatibility work runs beside release phases; dates alone never authorize
removal.

- The legacy blob live-fallback evidence window opened 2026-07-31 and lasts two
  to three months. The earliest target remains `0.14.x`, subject to every gate
  in `compatibility-ledger.json`.
- Retain migration receipts, diagnostics, the untouched source blob, rollback
  switch, and packaged Chrome/Firefox fixtures throughout that window.
- Treat damaged profiles as read-only export/backup recovery, not a normal
  serving path that pretends integrity.
- Retain the legacy blob reader as an import/recovery capability unless direct
  upgrade support is explicitly narrowed.

## Architecture invariants

- UI never owns durable turn, job, or agent truth.
- One persistence owner; queries do not commit stale state after caller timeout.
- Cancellation reaches provider and long-running browser work.
- Provider catalog absence does not prove failure or reachability.
- Unknown model capability resolves false unless a user override enables it.
- Provider replay artifacts remain opaque, bounded, unlogged, and unrendered.
- Content scripts cannot cross extension-page RPC policy boundaries.
- Browser and page content is untrusted input, never policy.
- App-generated persisted prose carries translation identity plus a safe
  fallback.
- Compatibility paths leave only after ledger evidence, never cleanup instinct.

## Deferred items

- Provider/page permission split: revisit with tested upgrade, denial, and
  revoke UX.
- One top-frame selection owner: revisit after cross-origin design and tests.
- Dev harness relocation: revisit with separate build configuration.
- Coverage thresholds: add only where meaningful domain thresholds exist.
- Tab capture: ship only as a complete user-gesture capability with a visible
  stop control, preserved audio, revoke handling, and ephemeral data.

## Maintenance rule

Remove work from this file once code and automated regression guards establish
it. Record shipped implementation history in the changelog and pull requests,
not in this roadmap. Update this file in the same change that alters unfinished
scope, phase order, release gates, or the decisions above; do not create another
active roadmap.
