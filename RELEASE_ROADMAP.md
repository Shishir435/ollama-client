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
| `0.13.0` | Solidify runtime, isolate domains, introduce first package boundaries | Active |
| `0.14.x` | Browser agent, built on isolated contracts and runtime kernels | Planned |
| Later | Remove compatibility paths only when ledger evidence permits | Evidence-gated |

## Current state

Landed on `release/0.13.x`:

- Durable turn ownership and MV3 restart recovery.
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
- Package extraction. Existing `src/application/**` boundaries are useful prior
  art, but physical packages have not landed.

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

#### P0 — freeze dependency rules

- Extend architecture contract tests before moving files.
- `chat` cannot import `agent`; `agent` cannot import `chat`.
- Contracts and runtime packages cannot import React, WXT, Chrome APIs, DOM,
  SQLite/OPFS, feature UI, or concrete providers.
- Composition happens in extension/background roots.

#### P1 — `packages/contracts`

Candidate ownership:

- Shared Zod schemas and inferred types.
- Streaming envelopes and stable event contracts.
- Failure taxonomy, command/result envelopes, receipts, and cancellation IDs.

Exit gate: package has no environment imports and both current app and tests
consume it through its public exports.

#### P2 — `packages/runtime-core`

Candidate ownership:

- Deterministic state-machine helpers.
- Retry, cancellation, checkpoint, evidence, and transition primitives.
- Ports/interfaces for clock, persistence, model invocation, and effects.

Exit gate: deterministic tests run without browser globals or extension setup.

#### P3 — domain runtimes

Extract only after P1/P2 prove useful:

- `packages/chat-runtime`: turn orchestration, context contracts, and tool-loop
  coordination behind ports.
- `packages/agent-runtime`: added in `0.14.x`; task compiler, policy, approval,
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

- Run `pnpm typecheck`, `pnpm lint:check`, and `pnpm test:run`.
- Run Chrome and Firefox production builds and packages.
- Run docs/resource generation when touched.
- Pass packaged-browser migration fixtures and preserve byte-level rollback
  evidence.
- Confirm one chat database writer and no second persistence engine.
- Confirm dependency-age policy, lockfile integrity, and bundle budgets.
- Soak provider connection, model discovery, chat recovery, ingestion recovery,
  and Firefox theme behavior.
- Release only after package-boundary work is mechanically boring and behavior
  remains unchanged.

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
