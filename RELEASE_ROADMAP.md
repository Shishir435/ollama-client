# Release Roadmap

Last reviewed: 2026-08-11

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
| `0.13.0` | Close the architecture-audit release blockers, soak on `preview`, then promote to `main` | Hardening required |
| `0.13.x` | Finish the focused non-blocking architecture follow-ups below | Incremental |
| `0.14.x` | Build the supervised browser agent | Planned |
| Later | Remove compatibility paths only when ledger evidence permits | Evidence-gated |

The `0.13.0` runtime foundation is established in code: shared contracts,
deterministic runtime primitives, and turn/context/tool-loop orchestration live
in environment-independent workspace packages. Browser, provider, persistence,
and UI adapters remain in `src/`. Architecture contracts, runtime schemas,
restart tests, test-layout checks, and documentation-comment checks guard those
boundaries automatically.

## `0.13.0` architecture-audit closure

The 2026-08-09 branch audit rated the architecture **7.5/10**. The target for
`0.13.0` is **9+/10**, meaning the release has no known Critical or High
architecture findings, privileged boundaries reject invalid callers and
payloads by construction, durable lifecycle intent survives worker loss, and
growth/recovery behavior is measured rather than assumed.

This section is release-blocking. Complete it in the order below because later
phases depend on the trust, startup, and lifecycle guarantees established by
earlier ones. Each phase must merge independently with the application usable
and all existing compatibility behavior preserved.

### Pull-request sequence

Use seven implementation pull requests plus one release-evidence pull request.
Do not combine them into one architecture branch: each PR must leave the
release usable and establish the tests required by its successor.

1. ~~**Persistence trust boundary (H0 + H1)**~~ — landed in #253.
2. ~~**Persistence readiness (H2)**~~ — landed in #255.
3. ~~**Durable turn lifecycle (H3)**~~ — landed.
4. ~~**Durable turn retention (H4)**~~ — landed.
5. ~~**Provider discovery policy (H5)**~~ — landed.
6. ~~**Durable turn composition (H6)**~~ — landed.
7. ~~**Boundary type/error closure (H7)**~~ — landed.
8. **Release evidence (H8):** run full Chrome/Firefox gates, record `preview`
   soak evidence, update release documentation, and promote only when the 9+/10
   criteria pass.

Critical path: **PR 8**, which is release evidence rather than code.

### H8 — Release verification and 9+/10 gate

Scope: M. Behavior change: none. Dependencies: none outstanding.

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

`0.13.0` earns the **9+/10** architecture rating only when:

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

The score does **not** require eliminating every Medium/Low cleanup item. It
does require each remaining item to have one clear owner, bounded risk, a
regression guard where practical, and an explicit later milestone below.

## Remaining foundation follow-ups

These are bounded improvements after H4–H8, not additional `0.13.0` release
blockers and not authorization for a repository-wide rewrite.

### Chat stream presentation boundary

`src/features/chat/hooks/use-chat-stream.ts` still combines port lifecycle,
reconnect and stop behavior, reducer effects, error presentation, and browser
side effects.

- Extract a framework-independent stream transport/session client around the
  existing schemas and pure reducer.
- Leave React state, translated errors, issue links, and other presentation
  effects in a thin hook adapter.
- Preserve restart, reconnect, stop, completion, and legacy-stream behavior with
  characterization tests throughout the extraction.

### Turn submission boundary

`src/features/chat/hooks/use-chat-turn-controller.ts` still combines UI
preconditions, session and user-message preparation, persistence error
presentation, and durable command construction.

- Move deterministic submission preparation and durable command construction
  behind a tested application boundary.
- Keep React state and translated toast presentation in the hook.
- Keep `use-chat.ts` as composition and wiring only.

### Cancellable startup recovery

Startup recovery tasks carry a deadline, but none of them accepts an
`AbortSignal`, so a timed-out task is abandoned rather than stopped and keeps
running beside the work that follows it.

- Thread cancellation through backup-import recovery, provider migration, the
  embedding-dimension migration, and durable workflow recovery.
- Keep the deadline as the outer bound; make it cancel rather than abandon.

### Structured settings validation

Raw `plasmoGlobalStorage` access remains widespread, while schema-backed
descriptors cover only part of the settings surface.

- Migrate high-risk structured values first and validate persisted/imported
  shapes at runtime.
- Preserve sync-versus-local ownership from `storage-key-registry.ts`.
- Move simple values opportunistically; do not use a flag-day migration.

### Provider manager decomposition

`src/lib/providers/manager.ts` still combines compatibility migration,
validation, secret recovery, provider CRUD, and model mappings.

- Preserve the public `ProviderManager` facade.
- Extract private mapping and migration collaborators only behind existing
  characterization coverage.
- Keep unknown-field preservation, journal recovery, and secret handling
  behavior unchanged.

### Message router decomposition

`src/background/message-router.ts` remains the authorized switch for retained
one-way and content-script traffic.

- Keep request/response provider and model operations on typed extension RPC.
- Move retained case bodies to named handlers without widening sender policy.
- Preserve registry and source-policy contract tests.

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
