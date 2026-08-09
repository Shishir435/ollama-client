# Release Roadmap

Last reviewed: 2026-08-09

This is the single living plan for the `0.13.x` foundation, package boundaries,
the `0.14.x` browser agent, and evidence-gated compatibility removal. It
replaces `PROGRAM_PLAN.md`, `FROM_SCRATCH_ARCHITECTURE_AUDIT.md`,
`BOUNDARY_MAP.md`, and `AGENTIC_BROWSER_ARCHITECTURE.md`.

Durable repository rules remain in `AGENTS.md`. Compatibility removal gates
remain authoritative in `compatibility-ledger.json`. This file tracks order,
status, scope, and release gates without duplicating either source.

Release promotion follows one path: `release/*` → `preview` → `main`.
Release work merges into `preview` for validation; only `preview` merges into
`main`.

## Version map

| Version | Purpose | Status |
| --- | --- | --- |
| `0.12.6` | Migration evidence, release provenance, provider and transcript correctness | Released |
| `0.12.7`–`0.12.8` | Fast provider, reachability, and Firefox theme fixes | Released; fixes forward-ported |
| `0.13.0` | Solidify runtime, isolate domains, introduce first package boundaries | Release candidate; hardening complete |
| `0.14.x` | Browser agent, built on isolated contracts and runtime kernels | Planned |
| Later | Remove compatibility paths only when ledger evidence permits | Evidence-gated |

## Current state

Landed on `release/0.13.x`:

- Durable turn orchestration and MV3 restart recovery; sole logical writer is
  still an audit closure gate below.
- Typed, validated streaming protocol with centralized event names.
- Durable ingestion and model-pull jobs.
- Per-table migration verification and retained rollback evidence.
- Single SQLite owner. Legacy blob fallback now uses official sqlite-wasm;
  sql.js and its duplicate WASM asset are gone from shipped package.
- Provider fixes from quick `0.12.7` and `0.12.8` releases.
- pnpm 11 and strict seven-day minimum dependency age.
- Activity labels and app-generated context titles persist translation keys.

Not on current release branch:

- Browser-agent runtime. Old agent branch is design and selective-port source,
  never a branch to merge wholesale.

Package extraction is complete on `release/0.13.x`: contracts, runtime-core,
and chat-runtime own the environment-independent schemas, primitives, and turn,
context, and tool-loop orchestration described below.

## Architecture audit refresh — 2026-08-09

Overall rating: **8/10**. Architecture has moved well past the concerns in the
original audit brief: entrypoints are thin, request/response traffic is typed
and validated, provider behavior is capability-driven, chat persistence has one
engine and one physical owner, and durable turn/job recovery accounts for MV3
worker suspension. Remaining work is boundary completion, not a rewrite.

### Current dependency map

```text
React shells and feature UI
  -> UI hooks/adapters
     -> versioned stream contracts | typed extension RPC
        -> background composition and authorization
           -> turn/context/ingestion/model-pull application services
              -> provider | browser | storage adapters
                 -> provider endpoints | browser APIs | SQLite/Dexie/storage

Persistence host
  -> one chat-db worker
     -> official sqlite-wasm
        -> OPFS, or read-only/compatibility legacy blob path
```

This direction is partly realized. `TurnService`, stream reducers, RPC schemas,
provider adapters, repository facades, and the persistence owner are strong
seams to preserve. `build-context.ts`, reminder tools, settings access, and the
UI streaming bridge still cross the intended direction in specific places.

### Strongest areas to preserve

- `src/protocol/` connects request and response types, validates both ends,
  authorizes senders, distinguishes queries from commands, and propagates
  cancellation. Do not replace it with ad-hoc messages or a generic event bus.
- `src/application/turns/turn-service.ts` expresses orchestration through small
  ports and has deterministic tests. Use this pattern for extracted runtime
  kernels; do not add repository interfaces everywhere.
- `src/background/durable-turn-runtime.ts`, durable job tables, and reconnecting
  stream snapshots make worker restart a designed path rather than an error
  case.
- `src/lib/providers/` keeps chat behind `LLMProvider` while retaining explicit
  capability and provider-specific management behavior. Preserve capability
  evidence order; do not build a lowest-common-denominator superclass.
- `src/lib/repositories/chat-history.ts`, the persistence host, and architecture
  contract tests enforce one SQLite engine, one owner, and one public facade.
- `storage-key-registry.ts`, provider-secret journaling, and sync quota guards
  establish useful storage ownership and recovery rules even though typed
  descriptor adoption is incomplete.

### Findings and required direction

| Severity | Evidence | Failure mode | Direction | Timing |
| --- | --- | --- | --- | --- |
| Critical | `use-chat-streaming.ts` debounces assistant-row writes while `durable-turn-runtime.ts` persists the same row | A delayed UI write can overwrite a newer background snapshot or terminal state; unmount does not clear the pending DB timer | Durable turns: background is sole durable writer. UI folds validated events into ephemeral state and reconciles from persisted snapshots. Keep a separately characterized compatibility path only if a non-durable caller remains | Before package moves, M |
| Critical | `tool-loop-runs.ts` casts `JSON.parse(row.state)` to `DurableToolLoopState` | Corrupt or older checkpoint can crash restart recovery at the point durability is needed most | Add versioned Zod checkpoint schema, validate nested messages/tool calls, and convert invalid rows into a safe failed/exportable recovery result | Before package moves, S–M |
| High | `build-context.ts` reads extension storage and constructs providers directly | Pure context tests still need extension/provider infrastructure; `runtime-core` extraction would move coupling instead of removing it | Inject settings, knowledge access, clock, and one-shot model invocation through `ContextService` composition; keep retrieval algorithms pure | Phase 2, M |
| High | `use-chat-stream.ts` owns port lifecycle, reconnect policy, reducer effects, i18n/error presentation, issue-link browser effects, and stop finalization | Restart, error, or stop changes touch one high-branch hook and can regress unrelated behavior | Extract a framework-free stream transport/session client around existing schemas/reducer; leave React hook as presentation adapter | Phase 2, M |
| High | About 35 production UI files still import deprecated `plasmoGlobalStorage`; only three use `useSetting` descriptors | Storage scope is guarded, but malformed persisted values and inconsistent defaults can still enter typed UI state | Migrate high-risk structured values first, attach runtime schemas, then move simple booleans opportunistically; no flag-day rewrite | `0.13.x` incremental, M total |
| High | `schedule-reminder-tool.ts` imports `background/lib/reminders.ts` | Lower-level tool registry depends upward on background composition, blocking clean package rules and alternate runtimes | Move reminder domain/service contract below background; keep alarms/notification registration in background adapter | Before boundary freeze, S |
| Medium | `ProviderManager` combines compatibility migration, validation, secret recovery, CRUD, and model mappings | Routine provider changes can disturb migration or credential recovery behavior | Preserve `ProviderManager` facade; extract private mapping and migration collaborators only with characterization tests | Later `0.13.x`, M |
| Medium | `message-router.ts` remains a large authorized switch for retained one-way/content-script traffic | Adding a case can mix sender policy, browser effects, response shape, and dispatch | Keep narrow non-RPC transports, but move case bodies to named handlers and keep registry/source-policy contract tests | Opportunistic, S–M |
| Medium | `use-file-upload.ts` clones captured `processingStates` before async work | Overlapping file submissions can replace another invocation's rows with stale state | Use functional state updates and move queue/registration coordination into the ingestion client/pipeline | `0.13.x` quick win, S |
| Low | Audit found public docs describing shipped `sql.js`, UI-owned final persistence, old RAG paths, and obsolete message guidance | Contributors could follow retired boundaries and recreate removed architecture | Corrected in this audit; keep factual architecture in docs and active sequencing here, with drift checks where cheap | Corrected; guard later, S |

No finding justifies a repository-wide rewrite. Existing runtime behavior should
remain usable after every change.

### Top stability risks

1. Stale UI debounce overwrites background-owned durable assistant state.
2. Invalid tool-loop checkpoint shape breaks recovery after worker restart.
3. Provider config/journal values are read through TypeScript generics without
   complete runtime schemas; malformed sync/import data can fail deep in CRUD.
4. Stop/disconnect/reconnect behavior remains concentrated in one React hook,
   making race fixes high-blast-radius.
5. Context building constructs providers and reads mutable storage mid-run,
   making replay less deterministic than its durable request suggests.
6. Concurrent `processFiles()` calls can lose UI processing-state entries.
7. Provider compatibility migration and ordinary CRUD share one manager path;
   a normal edit can accidentally affect recovery behavior.
8. Tool code importing background implementation hides runtime direction and
   makes a future agent/runtime package browser-bound.
9. Raw structured settings may admit stale shapes despite compile-time types.
10. No automated drift guard covers contributor paths, so deleted RAG,
    messaging, or persistence guidance can recur.

### Target boundary

```text
React UI
  -> presentation hooks
     -> StreamClient | ExtensionRpcClient
        -> background composition root
           -> application services and pure state machines
              -> explicit ports
                 -> provider, browser, repository, and storage adapters
```

SQLite remains a separate persistence-owner process boundary. RPC and streaming
stay separate transports because request/response and token delivery have
different lifecycle needs; they share schemas, failures, request ids, and
cancellation semantics rather than one universal abstraction.

Do not abstract concrete provider wire formats, browser permission differences,
SQLite/Dexie into one generic store, every browser API, or every one-implementation
module. Do not move code into packages until imports prove the boundary.

### Ranked quick wins

| Rank | Change | Impact | Effort | Risk |
| --- | --- | --- | --- | --- |
| 1 | Stop UI DB writes for durable assistant streams | Very high | M | Medium |
| 2 | Validate and version `DurableToolLoopState` | Very high | S–M | Low |
| 3 | Add contract test banning `src/lib/** -> src/background/**` | High | S | Low |
| 4 | Fix functional updates in `use-file-upload.ts` | High | S | Low |
| 5 | Runtime-validate provider configs and persistence journals | High | M | Medium |
| 6 | Move reminder service below background adapter | Medium | S | Low |
| 7 | Extract stream error presentation from port lifecycle | Medium | S–M | Low |
| 8 | Migrate highest-risk structured settings to descriptors | Medium | M | Low |
| 9 | Add package-candidate import contract tests before moving files | Medium | S | Low |
| 10 | Keep architecture/contributor docs synchronized with source contracts | Medium | S | Low |

## `0.13.0` phases

### Phase 1 — stabilization tails

Status: complete on branch worktree, 2026-08-09.

- Activity output previews and generated source titles now carry structured,
  translatable text while old persisted string values remain readable.
- `ActivityEventSchema` and `UsedContextChunkSchema` have one shared definition;
  stream validation no longer silently drops fields from a duplicate schema.
- RAG source keys use i18next JSON v4 plural suffixes.
- YouTube transcript extraction recognizes `/watch`, `/live/{id}`, and
  `/shorts/{id}` through one URL parser, with path tests.
- Locale catalogs regenerate cleanly; focused tests and typecheck pass.

### Phase 2 — package boundaries

Goal: chat and agent evolve independently. Neither domain may import the other.
Both depend downward on stable contracts and pure runtime kernels. Browser,
storage, provider, and UI adapters stay outside those kernels.

Package only proven seams. Do not turn `0.13.0` into a whole-repository move.

#### Audit closure gate — ownership before movement

Status: complete on `feature/prepackage-architecture-fixes`, 2026-08-09.

- Background is now the only durable assistant-row writer for durable turns;
  the characterized legacy stream path retains its UI debounce and heartbeat.
- Tool-loop checkpoints use a versioned Zod envelope; legacy rows validate
  through the same state schema, and malformed rows fail before replay.
- Reminder domain operations moved below background composition, with a source
  contract test preventing `application/lib/protocol -> background` imports.
- Overlapping file-upload submissions merge state through functional updates.
- Public architecture and contributor guidance match current runtime paths.

Exit gate: restart, reconnect, stop, and completion tests prove one logical
durable writer; corrupted checkpoint tests fail safely; lower layers do not
import background implementation.

#### P0 — freeze dependency rules

Status: complete on `release/0.13.x` via PR #243, 2026-08-09.

- Stored provider arrays validate required identity fields before runtime use,
  recover malformed optional fields independently, and preserve unknown fields
  across downgrade/upgrade cycles.
- Provider writes validate before journaling. Secret maps and both persistence
  and reset journals validate on recovery; malformed journals are discarded
  without applying partial cleanup or exposing stored values.
- Source contracts keep chat and the future agent mutually independent and
  keep current contract/runtime candidates free of UI, browser, persistence,
  background, and concrete-provider adapters.
- Forward-compatible provider fields remain preserved in storage while the
  provider RPC boundary explicitly projects known public fields, so newer
  fields cannot invalidate list responses or expose future credential fields.
- Boundary matching covers bound imports, type imports, side-effect imports,
  dynamic imports, and re-exports.

Completed:

- Architecture contracts are in place before files move.
- `chat` cannot import `agent`; `agent` cannot import `chat`.
- Current contract/runtime candidates cannot import React, WXT, browser and
  persistence adapters, feature UI, background composition, or concrete
  providers.
- Current composition remains in extension/background roots.

Remaining package work:

- P1: complete in `release/0.13.x` via PRs #244–#246.
- P2: complete in `release/0.13.x` via PR #247.
- P3: complete in `release/0.13.x` via PRs #248–#250. Agent runtime remains
  scheduled for `0.14.x`.

#### P1 — `packages/contracts`

Status: complete in `release/0.13.x` via PRs #244–#246, 2026-08-09.

Completed in the first extraction slice:

- Added the `@ollama-client/contracts` workspace package.
- Moved RPC envelope/version/method contracts, structured failure schemas, and
  stream version/event identifiers behind its public exports.
- Kept error conversion and browser/extension transport adapters in `src/`.
- Added package-only Node tests, an independent no-DOM typecheck, and a source
  contract that permits only relative imports and Zod.

Completed in the turn-schema slice:

- Moved shared chat, persisted context, and persisted turn Zod schemas into
  package subpath exports.
- Kept normalized application command types behind explicit compatibility
  adapters because legacy attachment bytes and replay artifacts have broader
  persisted shapes than runtime `ChatMessage`.
- Migrated stream and persistence schema consumers to package APIs directly and
  added clean-Node coverage for nested turn contracts and UTF-8 replay limits.

Completed in the provider/model RPC schema slice:

- Moved provider configuration, discovery, capability-probe, and connection
  request/result schemas behind the `@ollama-client/contracts/provider-rpc`
  export.
- Migrated the registry, provider service, and UI consumers to the package API;
  kept only application-wide `RpcMap` assembly in `src/protocol`.
- Added clean-Node tests for strict provider commands, credential-free public
  results, and provider-model normalization. Test tooling remains owned by the
  root workspace, not the runtime contracts package.
- Moved model lifecycle, library lookup, and embedding preparation/check
  request/result schemas into `@ollama-client/contracts/model-rpc`, with direct
  registry, service, and UI consumers.
- Added clean-Node coverage for model-detail defaults, bounded library inputs,
  loaded-model validation, and embedding error limits.

Completed in the final P1 slice:

- Moved diagnostics, ingestion-job, and model-pull-job request/result schemas
  behind package subpath exports and migrated their registry, service, runtime,
  UI, and test consumers directly.
- Added clean-Node tests for privacy-bounded support bundles, durable ingestion
  snapshots, model-pull progress, and sanitized failures.
- Removed temporary `src/protocol`, `src/types`, and `src/application` schema
  re-exports. `src/protocol/rpc-map.ts` now contains only application-wide
  method composition.
- Retained `toAppFailure`, `toRuntimeChatMessage`,
  `parseDurableContextOptions`, and `parsePersistedTurnRequest` as real
  application normalization adapters; they convert errors or persisted legacy
  shapes and do not re-export package contracts.

Remaining in P1: none.

Candidate ownership:

- Shared Zod schemas and inferred types.
- Streaming envelopes and stable event contracts.
- Failure taxonomy, command/result envelopes, receipts, and cancellation IDs.

Exit gate: package has no environment imports and both current app and tests
consume it through its public exports.

#### P2 — `packages/runtime-core`

Status: complete in `release/0.13.x` via PR #247, 2026-08-09.

Completed:

- Added the environment-independent `@ollama-client/runtime-core` workspace
  package with its own no-DOM typecheck and clean-Node test project.
- Moved the stateful streaming reasoning-tag parser into the package and
  migrated both chat and selection stream consumers to its public export.
- Moved the pure chat-stream reducer and its duplicate/out-of-order, thinking,
  tool, replay, empty-output, and terminal transitions into the package.
- Added keyed cancellation ownership and timeout lifecycle primitives; RPC,
  chat, selection, model-pull, and embedding-download callers retain only
  environment policy and adapters.
- Moved sender-evidence classification into runtime-core while leaving the
  message/port allowlist in the extension transport-policy registry.
- Moved Retry-After parsing and transient provider-status classification into
  the package while keeping provider-specific user messaging in `src/`.
- Added an injectable clock and persistence-writer port around checkpoint
  transitions, used by ingestion and model-pull durable jobs.
- Added an architecture contract that permits only relative modules and
  `@ollama-client/contracts` imports from runtime-core.

Remaining in P2: none. Browser transport authorization remains extension
policy; turn, context, and tool-loop
orchestration remain domain-runtime work for P3.

Candidate ownership:

- Deterministic state-machine helpers.
- Retry, cancellation, checkpoint, evidence, and transition primitives.
- Ports/interfaces for clock, persistence, model invocation, and effects.

Exit gate: deterministic tests run without browser globals or extension setup.

#### P3 — domain runtimes

Status: complete in `release/0.13.x` via PRs #248–#250, 2026-08-09.

Completed in the first turn-orchestration slice:

- Added the environment-independent `@ollama-client/chat-runtime` workspace
  package with a clean-Node test project and independent no-DOM typecheck.
- Moved durable turn submission, context/generation transitions, resume,
  completion/cancellation, and failure persistence into a port-driven runtime.
- Kept persisted-shape normalization, context callbacks, failure conversion,
  SQLite repositories, provider invocation, and browser streaming in extension
  composition.
- Added a source contract allowing only relative modules plus contracts and
  runtime-core dependencies from chat-runtime.

Merged in `release/0.13.x` via PR #248.

Completed in the context-orchestration slice:

- Moved context build command/output contracts, injected builder coordination,
  clock ownership, receipt projection, and source normalization into
  `@ollama-client/chat-runtime`.
- Kept RAG retrieval, provider and storage access, browser-derived inputs,
  activity callbacks, warnings, and prompt construction in the extension
  adapter.
- Added clean-Node tests for deterministic evidence, provider attribution,
  forward-compatible source normalization, and failed builds that mint no
  receipt.

Merged in `release/0.13.x` via PR #249.

Completed in the tool-loop orchestration slice:

- Moved the versioned durable tool-loop state and checkpoint envelope schemas
  behind `@ollama-client/contracts/tool-loop` while retaining legacy-row
  decoding and SQLite failure conversion in the repository adapter.
- Added a shared `@ollama-client/chat-runtime` coordinator for new/resumed
  state, model/tool transitions, cursor checkpoints, approval boundaries,
  taint advancement, trace reuse, and phase cleanup.
- Converged native and non-native ordered parallel batches on the same runtime
  executor; provider streaming, protocol formatting, tool execution, approval
  policy, browser effects, and persistence remain extension ports.
- Added clean-Node contract/runtime coverage and retained restart, approval,
  corrupt-checkpoint, taint, replay, native, and non-native integration tests.

Remaining P3 work: none.

Deferred to `0.14.x`: `packages/agent-runtime` task compiler, policy, approval,
controller, verification, and recovery.

Keep in extension `src/`:

- WXT entrypoints and browser messaging adapters.
- Chrome/Firefox permissions and page execution.
- React UI and feature stores.
- SQLite, OPFS, extension storage, and migration hosts.
- Concrete provider implementations until their storage dependency is removed.

#### Mechanical risks

- WXT expects `src/entrypoints/`.
- `@/` aliases, test setup, Biome, knip, source-contract tests, and bundle checks
  currently assume one source root.
- Storage is systematic coupling, not a file-move problem.
- Package extraction must not disturb migration compatibility or bundle budgets.

### Phase 3 — release hardening

Status: complete on `feature/release-0.13-hardening`, pending merge, 2026-08-09.

Completed evidence:

- `pnpm verify` passed package and app typechecks, Biome, knip, strict i18n,
  generated-resource drift, the compatibility ledger, and 2,627 tests across
  321 files. A frozen-lockfile install was already up to date.
- Chrome MV3 and Firefox MV2 production builds and ZIP packages passed manifest,
  CSP, permissions, lazy-locale, and bundle-budget checks. No duplicate shipped
  assets were present; package sizes remained below their release budgets.
- Packaged Chrome and Firefox migration fixtures passed fresh-profile startup,
  concurrent facade writes, every-table legacy import, integrity and foreign-key
  verification, migration receipts, legacy override, and OPFS export.
- Chrome additionally passed interrupted-migration resume, rejected-restore
  safety, and the critical install/restart/migration Playwright gates.
- Both browsers preserved the 3,457,024-byte rollback source byte-for-byte with
  SHA-256 `8c39ee7d447ed19837295a6f0bbf2f302cebef151a8857b0ed8dfb7e516a1fdf`.
- The production build contains one persistence-host worker and official
  sqlite-wasm engine. sql.js remains confined to benchmark fixture generation.
- A focused 79-test soak passed provider connection, model catalog/RPC,
  durable-turn recovery, interrupted-turn recovery, ingestion recovery, and
  theme persistence behavior.

Audit observation, not a shipped release blocker: `pnpm audit --prod` includes
the docs workspace and reported nine advisories (two already ignored by policy).
The only direct extension dependency reported was DOMPurify; the affected
`IN_PLACE` hook mode is not used. Its patched release and Mermaid's docs-only
patch are still younger than the strict seven-day dependency-age window, so the
lockfile was not forced past policy. Re-evaluate them after they age in rather
than adding a security-patch exception during release hardening.

Remaining Phase 3 work: none after this branch merges. Promote only through
`release/0.13.x` → `preview` → `main`.

## `0.14.x` browser-agent phases

### Product boundary

Ship one supervised browser agent first. Multi-agent remains a future extension
point, not initial runtime complexity. Agent operates through structured
observations, commands, policy, approval, execution, and verified effects.

Agent and chat may share contracts, model ports, tool primitives, and UI design
language. They do not share mutable stores, controllers, or feature internals.

### A0 — characterize and selectively port

- Treat `feature/agent-interaction-phase-1` as prior art only.
- Inventory code against current contracts and package boundaries.
- Port small reviewed slices; never merge old branch wholesale.
- Keep agent unreachable from production UI until safety and recovery gates pass.

### A1 — domain and controller skeleton

- Compile user request into explicit task specification, constraints, and
  completion criteria.
- Use deterministic states such as observing, deciding, awaiting approval,
  executing, verifying, paused, completed, and failed.
- Model proposes typed decisions; controller owns transitions.

### A2 — perception and command boundary

- Build bounded, ordered page snapshots with stable element references.
- Mark page content and tool output as untrusted.
- Initial actions: navigate, click, type/replace, select, scroll, read, and wait.
- Never guess an unsafe target when binding is ambiguous.

### A3 — policy, approval, and execution

- Read-only observation stays distinct from effectful commands.
- Policy evaluates origin changes, sensitive fields, destructive effects,
  downloads, submissions, and user constraints.
- Approval shows exact target, effect, origin, and relevant data before execution.
- Page text cannot lower policy or approval requirements.

### A4 — effect verification and completion

- Successful API/DOM execution is not proof of intended effect.
- Capture post-action evidence and compare expected effects.
- Detect navigation, DOM replacement, stale targets, and user interference.
- Only controller may declare completion after criteria are verified.

### A5 — durability and UI

- Checkpoint at model, command, approval, execution, and verification boundaries.
- Resume safely after MV3 worker restart without repeating unverified effects.
- Provide pause, resume, stop, heartbeat, and redacted debug export.
- UI separates conversation, work log, approvals, evidence, and final result.
- Preserve keyboard access and clear persistent running state.

### A6 — soak and compatibility

- Unit-test compiler, policy, reducer, verifier, redaction, and recovery.
- Contract-test model adapters, observation schema, commands, and checkpoints.
- Browser fixtures cover forms, navigation, dynamic DOM, rich editors, prompt
  injection, stale targets, and restart recovery.
- Evaluate task success, unsafe-action rate, unnecessary approvals, recovery,
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

- Legacy blob live fallback evidence window opened 2026-07-31 and lasts two to
  three months. Earliest target remains `0.14.x`, subject to every gate in
  `compatibility-ledger.json`.
- Retain migration receipts, diagnostics, untouched source blob, rollback
  switch, and packaged Chrome/Firefox fixtures through that window.
- Damaged profiles use read-only export/backup recovery, not a normal serving
  path that pretends integrity.
- Legacy blob reader remains an import/recovery capability unless direct upgrade
  support is explicitly narrowed.

## Architecture invariants

- UI never owns durable turn, job, or agent truth.
- One persistence owner; queries do not commit stale state after caller timeout.
- Cancellation reaches provider and long-running browser work.
- Provider catalog absence does not prove failure or reachability.
- Unknown model capability resolves false unless user override enables it.
- Provider replay artifacts remain opaque, bounded, unlogged, and unrendered.
- Content scripts cannot cross extension-page RPC policy boundaries.
- Browser/page content is untrusted input, never policy.
- App-generated persisted prose carries translation identity plus safe fallback.
- Compatibility paths leave only after ledger evidence, never cleanup instinct.

## Deferred items

- Provider/page permission split: revisit with tested upgrade, denial, revoke UX.
- One top-frame selection owner: revisit after cross-origin design and tests.
- Dev harness relocation: revisit with separate build configuration.
- Coverage thresholds: add only where meaningful domain thresholds exist.
- Tab capture: ship only as complete user-gesture capability with visible stop,
  preserved audio, revoke handling, and ephemeral data.

## Decision log

- `0.13.0` is foundation and isolation release, not agent-feature release.
- Package phase revived because chat/agent isolation supplies a real second
  consumer, even without CLI or desktop plans.
- Extract stable contracts and pure kernels first; avoid package theater and
  wholesale monorepo churn.
- Single-agent first. Multi-agent only after measured need and stable role ports.
- Agent old branch is selective-port source, never merge source.
- Four private, globally ignored plans retired in favor of this committed plan.

## Maintenance rule

Update this file in same change that changes phase status, release scope, or a
decision above. Do not create another active roadmap. Deep implementation detail
belongs near code, in tests, or in a focused ADR linked from here.
