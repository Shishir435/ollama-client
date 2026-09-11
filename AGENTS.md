# AGENTS.md

Guidance for AI coding assistants (Claude Code, Cursor, Warp, Copilot, etc.) working in this repository.

Rules here are stated as rules. Where a rule exists because something broke, the reason is one clause, not a story — `git log` has the rest.

## Contents

- [Project overview](#project-overview)
- [Commands](#commands)
- [Architecture](#architecture) — entrypoints, packages, chat round-trip, providers, RPC, storage, features
- [Subsystems](#subsystems) — RAG, web search, tools, agent runtimes, browser sessions
- [Conventions](#conventions) — messaging, UI, i18n, testing, lint, git hooks
- [Constraints](#constraints)
- [Provider API reference](#provider-api-reference)
- [Current state of known hotspots](#current-state-of-known-hotspots)

## Project overview

Browser extension (Chrome MV3 / Firefox MV2) for chatting with local and remote LLM providers, with local-first RAG over uploaded files and optional provider-backed web search. WXT, React 19, TypeScript 6, Tailwind v4, Biome.

Built-in verified providers: **Ollama, LM Studio, llama.cpp**. vLLM, LocalAI, KoboldCPP and other compatible servers are added through the OpenAI-compatible custom-provider flow. Anthropic is a custom provider on the native Claude Messages API. `openai-compatible.ts` is the shared implementation, not a separate built-in tile.

## Commands

```bash
pnpm install                # Install dependencies
pnpm dev                    # Dev build, Chrome MV3
pnpm dev:firefox            # Dev build, Firefox MV2
pnpm build                  # Production build, Chrome MV3
pnpm build:firefox          # Production build, Firefox MV2
pnpm package                # Zip Chrome build for upload
pnpm package:firefox        # Zip Firefox build for upload

pnpm test                   # Vitest, watch mode
pnpm test:run               # Vitest, one-shot
pnpm test:related           # Only tests affected by working-tree changes
pnpm test:coverage          # Coverage report

pnpm lint:check             # Biome check (no writes)
pnpm lint:fix               # Biome check --write
pnpm format:check           # Biome format check
pnpm format:fix             # Biome format --write
pnpm typecheck              # tsc --noEmit, extension and packages

pnpm docs:dev               # Astro dev for the docs site (docs/)
pnpm docs:build             # Astro build → docs/dist/

pnpm olc                   # Start/reuse native Ollama (11434)
pnpm proxy:opencode         # Run the olc proxy with OpenCode
pnpm proxy:opencode:debug   # Run OpenCode with verbose proxy logging
pnpm proxy:codex            # Run the olc proxy with Codex
pnpm proxy:codex:debug      # Run Codex with verbose proxy logging
pnpm proxy:bundle           # Bundle it to packages/olc/dist/olc.mjs

pnpm generate:resources     # Validate locales, regenerate derived extension assets
```

**Before opening a PR:** `pnpm typecheck && pnpm lint:check && pnpm test:run`.
**If you touched `docs/` or `src/locales/`:** also `pnpm docs:build && pnpm generate:resources`.

## Architecture

### Entrypoints (WXT)

WXT discovers entrypoints from `src/entrypoints/`. Each is a thin bootstrapper that mounts a shell from elsewhere in `src/`.

| Entrypoint | File | Mounts |
|---|---|---|
| Side panel | `src/entrypoints/sidepanel/index.tsx` | `src/sidepanel/index.tsx` (chat UI) |
| Options page | `src/entrypoints/options/index.tsx` | `src/options/index.tsx` |
| Background worker | `src/entrypoints/background.ts` | `src/background/index.ts` |
| Content script | `src/entrypoints/content.ts` | `src/contents/index.ts` |
| Selection overlay | `src/entrypoints/selection-button.content.tsx` | self-contained content UI |
| Print page | `src/entrypoints/print/` | print-friendly export |

- Manifest — permissions, CSP, host permissions, `browser_specific_settings` — lives in **`wxt.config.ts` only**.
- Dev-only entrypoints (`spike-*`, `benchmark`, `persistence-verify`) are stripped from store builds by `config/wxt-hooks.ts`, and their code is eliminated via the `__SPIKE_OPFS_OWNER__` flags in `config/wxt-vite.ts`. `src/spike/` is therefore fine where it is.

### Workspace packages

| Package | Owns |
|---|---|
| `@ollama-client/contracts` | environment-independent Zod schemas, RPC/stream envelopes, durable turn/context/tool-loop contracts |
| `@ollama-client/runtime-core` | deterministic stream reduction, thinking parsing, cancellation, retry, checkpoint, sender-evidence primitives |
| `@ollama-client/chat-runtime` | port-driven durable turn, context-build, and tool-loop orchestration |
| `@ollama-client/olc` | standalone Node CLI: native Ollama setup and explicit OpenAI-compatible agent proxies ([details](#agent-runtimes-via-the-olc-proxy)) |

- The first three never import React, WXT, browser APIs, persistence adapters, feature UI, background composition, or concrete providers. Those stay in `src/` and connect through package ports.
- Every package carries the extension's version; `config/__tests__/package-versions.test.ts` fails on drift.

### Chat round-trip

1. UI opens a runtime port keyed by `MESSAGE_KEYS.PROVIDER.STREAM_RESPONSE`.
2. `src/background/index.ts` routes by message key to `src/background/handlers/`.
3. `ProviderFactory.getProviderForModel(modelId)` resolves the provider via `registry.ts` and the user's saved mapping.
4. The provider streams tokens back through the port; the background durable turn owner persists assistant state while `use-chat.ts` updates ephemeral UI state.

### Providers (`src/lib/providers/`)

| File | Role |
|---|---|
| `types.ts` | `LLMProvider`, `ProviderConfig`, `ProviderType`/`ProviderId` enums |
| `registry.ts` | static metadata for built-in providers |
| `factory.ts` | `ProviderFactory.getProviderForModel()` |
| `manager.ts` | stable provider CRUD/routing facade |
| `provider-config-repository.ts` | locked config recovery, hydration, defaults, legacy URL adoption |
| `provider-mapping-repository.ts` | scoped model mapping migration and CRUD |
| `provider-compat-migration.ts` | removed-beta remapping, sanitization, duplicate retention |
| `selected-model.ts` | active model state |
| `capabilities.ts` | capability detection and per-flag attribution |
| `model-discovery.ts` | the only production path that asks a provider for a catalog |
| `model-lifecycle.ts` | shared lifecycle result normalization and safe provider errors |
| `ollama.ts`, `lm-studio.ts`, `llama-cpp.ts` | verified built-ins |
| `openai-compatible.ts` | custom OpenAI-compatible endpoints |
| `anthropic.ts` | native Claude Messages API |

Legacy vLLM/LocalAI/KoboldCPP subclasses are compatibility-only, not UI profiles. **Default fallback is Ollama** when no explicit model→provider mapping exists.

#### Model discovery

- **A catalog is not a requirement.** A provider's models are whatever `/models` returns *plus* the user's `customModels`, merged either way (`mergeProviderModels`). Never gate a provider, a connection test, or the model menu on a catalog request succeeding.
- All callers — RPC listing, connection tests, background health checks, tool capability resolution, the embedding-model check — go through `model-discovery.ts`. `discoverProviderModels(provider)` keys on the config it reads off that provider, so an answer cannot be filed against the wrong endpoint.
- A failure is **returned as `catalog: "failed"`, never thrown**: a missing catalog is normal for the model menu and disqualifying for a connection test.
- `architecture-boundaries.test.ts` fails on any `.getModels(` outside `model-discovery.ts`. The single exemption is `super.getModels`, a subclass delegating to its base wire format.
- 404/405/501 is remembered device-local in `model-catalog-support.ts`, fingerprinted by wire + base URL + service profile, expiring after a day. No answer, 401, 429 and 5xx are **never** recorded — they say nothing about whether the endpoint exists.
- The default provider's embedding check keeps its direct `/api/tags` fetch: it skips provider resolution, and remembered absence exists to spare metered remote endpoints, not the user's loopback Ollama. Do not copy that shape for a configured remote provider.
- **A missing catalog never proves reachability** — a mistyped base URL answers identically. An explicit (`draft`) test confirms a catalog-less provider by streaming one token from `/chat/completions`; a missing chat route is reported as a base-URL problem and clears the recorded answer. The background (`stored`) check never sends that request: it is a health poll, not a licence to spend inference.

#### Capability detection

- Resolution order, highest first: user override → empirical probe (`capability-probe.ts`) → model metadata → provider default. An unknown capability resolves to `false`; only an override may flip it on. Never enable vision or tool calling on a guess.
- Metadata evidence, strongest first: Ollama `/api/show` `capabilities[]` → LM Studio `capabilities[]` (for the flags it names) → OpenRouter-style `modalities`/`supported_parameters` → LM Studio `type` (a category, not a statement about the model) → provider default.
- An **empty** metadata array means "unknown", never a reported no; empty catalog arrays are placeholders often enough that treating them as negatives disables working models.
- A new metadata source updates both `getModelCapabilities` and `getModelCapabilityStates`. The second drives the capability sheet's attribution and must not contradict the first.
- **Model lifecycle wires stay in provider adapters.** `LLMProvider.modelLifecycle` is an optional port for loaded-model listing, unload and warmup. `ModelRpcService` owns RPC policy and warmup cooldowns but never builds vendor URLs or branches on provider ids. A capability flag and its operation must agree; a provider without the operation returns unsupported rather than receiving an Ollama-shaped request.

#### Model list metadata

Differs sharply by server, so check before assuming a field exists.

- **Ollama** `/api/tags` omits `family`, `parameter_size` and `quantization_level` for non-GGUF (safetensors/MLX) models. `getModels` backfills from `/api/show` only for models whose format is reported, non-GGUF and sizeless; capped fan-out, and a failed lookup leaves the model as-is.
- **LM Studio** reports no size on any endpoint. `parameterSizeFromModelId` reads it from the id by convention and refuses when the id is ambiguous. Never put `max_context_length` in `parameter_size` — that shipped once and rendered a token window as a model size.
- **llama.cpp** reports `meta.n_params`, already formatted to one decimal.
- `formatParameterSize` normalizes whatever arrives, so one list cannot mix `8B`, `8.2B` and `999.89M`.

#### Vendor marks and favicons

- **Vendor marks are display-only.** `provider-brand.ts` resolves a `ProviderBrandId` from built-in id, then base-URL host, then service profile, then display name; `mergeProviderModels` stamps it on every model row as `providerBrand`. Host beats profile, or every OpenAI-compatible provider would wear OpenAI's mark. An unrecognized provider gets no brand and falls back to the registry glyph. Never guess one, and never derive routing or capabilities from it.
- Marks are inline monochrome SVG in `src/components/icons/provider-brand-icons.tsx` (from MIT-licensed `@lobehub/icons`), rendered through `<ProviderIcon>`, not imported directly.
- **Favicons are the tier below**, for unrecognized *remote* providers only (`provider-favicon.ts`, served by `providers.icons`). Rules, all load-bearing:
  - The configured base URL is asked first. Its parent site is asked **only** after a settled "nothing here" (401/403/404/410, or a 200 carrying non-image bytes — a gateway guards `/favicon.ico` behind its key like every other path). Timeouts and 5xx are never chased.
  - Exactly one label is stripped (`api.acme.com` → `acme.com`), never down to a public suffix.
  - No third-party favicon service, ever: that would hand every configured provider URL to whoever runs it.
  - Loopback, private, CGNAT and link-local hosts are refused (`169.254.169.254` is the cloud metadata endpoint, and this fetch reaches what a page cannot), and **redirects are refused, not followed** — the host check vets the address we picked, not the one a 302 would pick for a request holding `<all_urls>`.
  - Responses are sniffed from leading bytes rather than trusted from `Content-Type`, capped at 32KB. Hits and misses are both remembered device-local; nothing is recorded once the caller aborted.
  - The filter reads hostnames, so a public name resolving to a private address still passes, and no extension API closes that (`chrome.dns` is dev-channel only; resolving first is TOCTOU because `fetch` looks up again). What bounds it is that nothing leaves the device: no credentials, non-image bytes discarded, and a provider the user already trusts with their prompts. Do not add a resolve step — the honest mitigation is the off switch, which also drops what was already fetched.

### RPC boundary (`src/protocol/`)

Every provider, model, and embedding request/response crosses the extension-page/background boundary through the versioned RPC contract.

| File | Role |
|---|---|
| `rpc.ts` | protocol version, `RpcMethod`/`RpcErrorCode`, envelopes |
| `provider-rpc.ts` | `providers.*` schemas, typed `RpcMap` |
| `model-rpc.ts` | `models.*`, `embeddings.*` schemas |
| `diagnostics-rpc.ts` | `diagnostics.*` schemas |
| `rpc-registry.ts` | per-method schema, sender policy, timeout, operation metadata |
| `extension-client.ts` | validated extension-page client |
| `src/background/rpc-server.ts` | authorization, validation, dispatch, safe errors |
| `src/lib/providers/provider-rpc-service.ts` | background-owned provider-config ops |
| `src/lib/providers/model-rpc-service.ts` | background-owned model lifecycle and catalog ops |

Adding a method:

- Register it in `RpcMethod`, `RpcMap` and `RPC_METHOD_DEFINITIONS`; refer to it through the enum, never a duplicated wire string.
- Validate both ends. Keep credentials out of results and diagnostics. Return i18n message keys plus safe fallback text.
- `allowedSources` is `["extension-page"]` for every method, asserted by a contract test. Content scripts never reach the protocol, because page-controlled data influences their messages — widening this is a security decision, not a registry edit.
- Queries must have no persistence side effects, so a client timeout cannot commit stale state. Persist derived state only after the caller accepts the result.
- Client timeouts send `app-rpc-cancel`; the server aborts the matching request and passes the `AbortSignal` into provider fetches. Preserve that path for anything long-running.
- Widening `capabilityHints` means editing the schema *and* its transform in `provider-rpc.ts` — the transform whitelists fields, so a schema-only change silently drops the value.

### Storage

Chat history is **SQLite-only**, on one engine and one writer: official sqlite-wasm, in a worker owned by the persistence host. sql.js is a devDependency, used only by measurement pages to write old-topology fixtures. Dexie remains for vector embeddings and knowledge sets.

**No context outside the owner holds a database handle.** `src/lib/sqlite/db.ts` is an RPC client, `getDb()` no longer exists, and a second engine or writer is a change to argue for in review rather than make.

| Data | Where |
|---|---|
| Chats, sessions, messages, files | `src/lib/repositories/chat-history.ts` — a facade over `sqlite-chat-history.ts`. Go through the facade. |
| SQLite internals | `src/lib/sqlite/` (`db.ts` RPC facade, `schema.ts`, `migrations/`) |
| The engine itself | `src/lib/persistence/chat-db-engine.ts`, wrapped by `chat-db-worker.ts` |
| On-install embedding-dimension migration | `src/lib/migration/`, invoked from `src/background/index.ts` |
| Vectors / embeddings | `src/lib/embeddings/` — IndexedDB via `storage.ts`, not migrated to SQLite |
| Settings, config, per-extension state | `@plasmohq/storage` via `src/lib/plasmo-global-storage.ts` |

- **Session metadata** — pinned state, per-chat system prompts, user tags — lives on SQLite `sessions`. Add columns through forward-only migrations.
- **Message-subtree deletion is atomic.** `deleteMessageSubtree` discovers descendants, repairs `sessions.currentLeafId`, and deletes message/file rows in one transaction. Dexie vectors cannot join that commit; callers clean them up afterward by the returned message ids, idempotently.
- **Durability depends on the backend.** On **opfs** a committed statement is already durable and `flushSave()` is a no-op; on the **legacy blob** the owner debounces a full-image write by 1s and `flushSave()` forces it. Callers flush at unload, migration and export boundaries without knowing which answered.
- **A damaged legacy image is served read-only.** A blob failing `integrity_check` keeps reads, backup export and diagnostics; writes throw and migrations do not run. Never write it back — it is the rollback artifact.
- **Turn lifecycle is a state machine, enforced in SQL.** `TURN_STATUS_PREDECESSORS` (`packages/contracts/src/turns.ts`) is the whole truth; every status write is a compare-and-set against its allowed predecessors.
  - `updateTurnRun` resolving false means another owner has the turn: `TurnRuntime` then does no provider work.
  - A stop commits `cancelling` **before** aborting the controller, so a worker lost mid-stop restarts into recovery rather than handing a `generating` row back to the provider.
  - Startup finalizes interrupted cancellations without reissuing anything, and terminally fails an unparseable row with a content-free diagnostic.
- **A settled turn keeps no resumable input.** `turn_runs.request` holds the whole prior conversation, file text, page bodies and base64 images — necessary while resumable, and O(n²) bytes per chat once it is not.
  - `compactedTurnRequest(...)` replaces it **in the same statement that writes the terminal status** (`updateTurnRun`, `finalizeCancelledTurn`, `quarantineTurnRun`), never in a later pass a dying worker could skip. Migration 14 cleared the backlog.
  - What survives as evidence: the bounded `contextReceipt`, the message rows it points at, and the recorded failure.
  - `getTurnRun` returns no request at all; only `getIncompleteTurnRuns` parses the full shape, and an already-compacted resumable row is quarantined.
  - `pruneTerminalTurnRuns` bounds receipts by status, never by age alone — a browser closed for six weeks still owes the user its interrupted turns. The `turn_retention` diagnostic reports counts and byte lengths only, and a non-zero `uncompactedTerminalRuns` is the one condition nothing self-corrects.
- **A failure generation produced is recorded as it stands.** `DurableTurnGenerationError` carries the structured `AppFailure` from the terminal stream event through the turn row, the assistant row, the reconnect snapshot and the bubble. Rebuilding an `Error` from its text turned a provider 500 into a bare "Turn failed before completion."
- **Tool-loop durability** — native and non-native tool loops checkpoint to `tool_loop_runs` at model/tool/approval boundaries and force-flush before awaiting approval. The sidepanel reconnects with the same request id after an MV3 worker restart. Keep that checkpoint/reconnect contract.
- **Reasoning replay** — signed Anthropic thinking/redacted blocks and OpenRouter `reasoning_details` live in the versioned, size-capped `ChatMessage.replayArtifact`, separate from display-only `thinking`. Preserve block order and opaque values through SQLite and checkpoints, validate provider/model ownership before replay, and never render or log opaque contents.
- **Sync vs local** — sync-safe settings use `chrome.storage.sync`; device-local keys are routed to `chrome.storage.local` by the wrapper.

#### State ownership

Four systems hold live values. Each value has exactly one owner; the rest read it. Picking the wrong owner is how a value ends up written from two places with no rule for which wins.

| System | Owns | Never holds |
|---|---|---|
| **SQLite** (`chat-history.ts` facade) | chats, sessions, messages, attachments, prompt templates, tool-loop checkpoints, durable job runs | anything a UI needs synchronously on first paint |
| **Dexie / IndexedDB** (`lib/embeddings/`, `lib/knowledge/`) | vectors, HNSW and keyword indexes, knowledge sets, chunk feedback | anything SQLite already owns — chat rows never live in both |
| **`chrome.storage`** via `plasmoGlobalStorage` | settings, provider config and mappings, capability overrides, approval grants, handoff flags, persistence markers, the migration receipt | bulk data, and anything large enough to matter against the sync quota |
| **Zustand stores** | ephemeral UI state: selected tabs, input draft, stream progress, speech, search dialog | durable values, unless the store explicitly reads and writes through one of the systems above |

- **Every `chrome.storage` key needs a descriptor** in `src/lib/storage/storage-key-registry.ts` with its sync scope and a `reason`. `storage-key-registry.test.ts` asserts registry and `STORAGE_KEYS` match exactly.
- **Two stores are durable-backed and say so:** `stores/theme.ts` and `stores/shortcut-store.ts`. Every other store dies with the page — do not add a durable value to one.
- **`MESSAGE_KEYS` are not storage keys.** They name runtime ports and one-way events, hold nothing, and stay out of the storage registry.
- The background/application layer owns durable workflows; the UI submits intent. A durable value written directly from a component is a boundary violation even when it works.

#### Persistence host and owner

- The host (Chromium offscreen document / Firefox MV2 background page) owns the only chat-db worker and reports worker `error`/`messageerror` with their cause — a bare "worker crashed" hides the failure. In dev the worker loads from the Vite dev server, which is why `worker-src` allows that origin during `serve` only (`config/__tests__/manifest-csp.test.ts` guards both halves).
- The host chooses the backend once per session from the marker and the migration outcome. `setBackend` is host-only and the RPC listener rejects it from any sender. A migration that fails verification **resolves onto the legacy backend**; only the owner failing to start rejects. That is what lets `ensureMigrated` be awaited before every request.
- **An owner is ready when it answers, not when it exists.** `chrome.offscreen.createDocument()` resolves before the page has evaluated its script. `ensurePersistenceOwnerReady()` proves the chain with one `ping` under its own 30s cap and caches the proof per owner instance — never the failure, so a later caller retries.
- Startup order: lifecycle flags → owner → data-shape recovery (backup import, provider migration, embedding-dimension migration; sequential, because they rewrite what follows reads) → durable workflow recovery (bounded concurrency).
  - The composition root hands one readiness promise to `initializeBackgroundStartup`; DB-touching work awaits it, and is skipped for the boot when it rejects.
  - Every task takes an `AbortSignal`, no successor starts until the task settles, and a supervisor abort leaves durable user work resumable rather than recording a user cancellation.
  - Adding a DB-touching startup task means listing it there and threading the signal through every mutation boundary — not `void`-ing it beside them.
- **Retrying a write needs evidence.** `RETRYABLE_OPS` names the ops idempotent by construction; anything else is retried only on `PersistenceNotDeliveredError`, which is raised before a byte is sent and therefore proves non-execution. Do not widen either rule to make a flaky boot look better.
- **Failures are typed** (`src/lib/persistence/errors.ts`). `PersistenceError` carries `op`, a `reason` (`not-delivered`/`timeout`/`owner-error`/`invalid-response`), a `retryable` getter applying the rule above, and safe `userMessage` text.
  - The owner's message never becomes the error text: it forwards SQLite verbatim, naming tables, columns and statement fragments, so it travels as `detail` while `message` stays a safe summary.
  - `detail` and `cause` are declared under `PRIVATE_ERROR_KEYS` (`src/lib/log-redaction.ts`) and non-enumerable, because structured logging copies enumerable own properties **and** follows `cause` by name. The opt-in symbol exists because name-keyed redaction cannot cover a value whose sensitivity comes from where it was obtained.
- The in-process fast path is labelled by the **owner**, because the client cannot tell its two stages apart: `registerPersistenceHost` wraps startup failure as `PersistenceNotDeliveredError` (nothing posted yet, and `ensureMigrated` clears its memo so the retry re-attempts), while anything from `callWorker` onward stays `owner-error`. Everything the client wraps itself takes `owner-error` — claiming non-execution it cannot prove is what turns a lost write into a duplicated one.
- **Durable rows are decoded, not asserted.** `query` resolves a bag of `SqlValue`s, so `as unknown as Row[]` is an unchecked claim: a column dropped by a half-applied migration arrives as a well-typed object that is wrong.
  - Every durable job repository declares a Zod row schema and goes through `decodeRow`/`decodeRows` (`row-decoder.ts`), which logs failing paths and codes plus the row id, and nothing else — never Zod's messages, since an enum mismatch embeds the stored value.
  - `decodeContext.table` is the shared `DurableTable` union (`persistence/durable-tables.ts`), so a typo is a typecheck failure.
  - `architecture-boundaries.test.ts` fails on a row-collection assertion in **any** module importing `@/lib/sqlite/db`, scoped by what a module does rather than where it lives. Object- and function-typed shims for under-typed browser APIs stay allowed.
- Decode failure policy is per-repository and deliberate: `turn_runs` quarantines and falls back to an id-only read, so an undecodable row can still be settled; `tool_loop_runs` raises, because its caller is mid-resume; ingestion and model-pull drop and log, because one bad row must not deny recovery to the rest. `durable-row-contract.smoke.test.ts` drives the real engine to prove each writer and its schema agree.
- **Keep the engine reachable without a Worker.** `chat-db-engine.ts` is split from `chat-db-worker.ts` so tests can drive it in-process; there is no Worker and no OPFS in vitest. The legacy backend runs fully in vitest (`legacy-blob-backend.test.ts`); OPFS is covered by `pnpm verify:opfs-migration`.

### Feature modules (`src/features/`)

Each feature owns its UI, hooks, and — if needed — its Zustand store.

| Feature | Contents |
|---|---|
| `chat/` | chat UI, `use-chat.ts`, speech store. **No `rag/`** — retrieval lives in `src/application/context/rag/` |
| `sessions/` | session list + repository, `chat-session-store.ts` |
| `model/` | model management UI, provider/embedding settings |
| `file-upload/` | ingestion for RAG, per-format `processors/` |
| `prompt/` | prompt templates |
| `settings/` | six intent tabs, settings registry, i18n-backed search, legacy deep-link redirects |
| `selection-actions/` | in-page selection overlay |
| `web-search/`, `permissions/`, `privacy/`, `knowledge/`, `memory/`, `context/`, `tabs/`, `diagnostics/` | auxiliary |

**Feature-scoped stores live in `features/<x>/stores/`, never `src/stores/`.** `src/stores/` is only for cross-feature concerns (theme, shortcuts, search dialog).

## Subsystems

### RAG / embeddings

- Pipeline: `src/application/context/rag/` (`rag-pipeline.ts`, `rag-retriever.ts`, `rag-prompt-builder.ts`, `query-classifier.ts`), driven by `src/application/context/build-context.ts`. It left `src/features/chat/` when context building went to the background — a feature directory cannot own work the background performs.
- **All** file, memory and live-page splitting goes through `src/lib/embeddings/chunker.ts`. Do not build a parallel text splitter.
- Plumbing: `src/lib/embeddings/` (`embedding-strategy.ts`, `embedder-factory.ts`, `hnsw-index.ts`, `keyword-index.ts`, `storage.ts`, `chunker.ts`, `search.ts`).
- Embedding strategy chain: provider-native → shared model → Ollama fallback.
- Hybrid search: keyword (`minisearch`) + dense (`hnsw`), configurable weights.
- Reranking is a **cosine-similarity re-scorer** (`reranker.ts`), on by default — **not** a cross-encoder. A transformers.js / ONNX Runtime cross-encoder was blocked by MV3 CSP and never shipped; neither library is a dependency. `config.ts` accepts the legacy `transformers-js`/`onnxruntime-web` strings only as a shim collapsing them to `cosine`.
- There is no `src/lib/rag/core/` tree. Any doc referencing one is stale.

### Web search

- Runtime: `src/lib/tools/web-search/`. `WebSearchBackend` adapters keep provider wire formats behind one `web_search` tool.
- Backends: SearXNG (`GET /search?q=…&format=json`), Brave (`GET api.search.brave.com/res/v1/web/search`, `X-Subscription-Token`), Tavily (`POST api.tavily.com/search`, bearer).
- Settings UI: `src/features/web-search/`, mounted in the internal `context` tab (shown as "Knowledge & web"). Config is device-local via `STORAGE_KEYS.WEB_SEARCH.CONFIG`. **Never log API keys.**
- Result counts: SearXNG has `pageno` but no count parameter — fetch configured pages, de-dupe, then cap. Brave uses `count`; Tavily uses `max_results`.
- Treat snippets and titles as untrusted. Cap per-result snippets and total tool output, and instruct models to cite returned URLs for current facts.

### Internal LLM tools

Model-callable tools live in `src/lib/tools/internal/`, registered in `internal-tool-source.ts`. When adding one:

- Give it a stable `displayNameKey` and add that key to `chat.reasoning.trace` in **every** `src/locales/<lang>/translation.json`, or the reasoning trace shows raw key paths.
- Run `pnpm generate:resources` after locale edits.
- Keep privacy-sensitive tools on the same permission and scope filters as their indexing/search pipeline. A live tool must not bypass user exclusions.
- Browser-data tools pass two independent gates before any provider sees them (`background/lib/tool-exposure-policy.ts`): the optional permission is granted **and** the current request asks for that data (`optional-permission-intent.ts`, which tolerates a one-edit typo in the keyword carrying the intent). Provider-side `tool_choice: auto` is not a privacy boundary.

### Agent runtimes via the olc proxy

`packages/olc` is a Node CLI, not extension code. Bare `olc` manages native Ollama
through `src/ollama/` on port 11434; it never wraps Ollama in the proxy.
`-b` / `--backend codex|opencode` explicitly selects the agent proxies on ports 8083 (Codex) and 8084 (OpenCode).
All CLI backends detach by default; `--debug` or `--foreground` stays attached.
Proxy readiness crosses a private IPC handoff before the launcher exits.
Foreground native sessions stop only the standalone child they create, never an adopted service.
Native lifecycle tests mock OS effects; never restart a developer's Ollama during validation.
Native olc never persists environment or configuration: no `launchctl setenv`,
systemd drop-ins, registry/user variables, or shell-profile edits. Pass
`OLLAMA_*` only to a standalone child; reuse compatible managed servers and
refuse changes that require their owner. The macOS app may be gracefully quit
and replaced by a standalone child, without relaunching or reconfiguring it.
In agent mode it serves a local agent runtime over `/v1/chat/completions`, so that runtime's models reach the extension through the ordinary OpenAI-compatible custom-provider flow.

- **Nothing in `src/` knows it exists.** Do not add proxy-aware branches to the extension: provider-shaped behaviour belongs behind the provider's own wire format, not behind a base-URL check in a handler.
- **An image is a part, not text.** An `image_url` content part carries no `text`, so flattening a message to a string drops it silently and leaves the model answering about pictures it never saw. `buildPromptParts` emits image parts as OpenCode file parts alongside the text, in message order.
- **Capabilities travel in the catalog.** `/v1/models` reports the runtime's own tool-calling, reasoning and modality flags as `capabilities`, `supported_parameters`, `input_modalities` and `output_modalities` — exactly what `openai-compatible.ts` already reads. A provider-level image tool is a dedicated image-output model, not an output flag on every text model.
- **Generated images are bytes, not links.** `/v1/images/generations` accepts the OpenAI-compatible `b64_json` shape and returns only validated base64 from the selected backend. A missing runtime image operation is `501`, never a text fallback disguised as image generation.
- **Tool calls round-trip through the wire format.** The runtime does not forward a caller's tool definitions to its model, so the proxy registers them, parks a call mid-turn, emits it as an OpenAI `tool_calls` delta with `finish_reason: "tool_calls"`, and resumes the same turn when the next request carries matching `tool_call_id`s. The extension's native tool loop drives it unchanged, and its approval and permission gates still apply because the tools still execute in the extension.
- Inside the proxy, `src/core/` is runtime-agnostic and every runtime detail sits behind the `AgentBackend` port (`src/backends/types.ts`), with OpenCode as the first adapter. A new runtime is an adapter plus a registry entry, never a change in `core/`.
- **A decision is isolated; the session behind it is not free.** Every chat
  request that carries no trailing tool results starts a new backend turn, so
  the extension's agent — which sends one full conversation per step and never
  returns a tool result for the decision it parsed — gets an isolated session
  per decision. Nothing in the wire says a client will not resume, and it must
  not be inferred: a client may legitimately start fresh work while still
  computing a result for a turn it left parked, so discarding on that basis
  throws away work it is about to hand back. What is not defensible is
  unbounded, so `MAX_PARKED_TURNS` caps how many turns may sit parked and a
  fresh request discards the oldest above it, never one with a resume hold.
  Before that, only each turn's own ten-minute TTL ended one, and a
  twenty-five-step run held twenty-five live sessions at once.
- **Every terminal path settles the session and the slot.** A response that
  stopped is not a session that ended: a parked turn is a live runtime session
  and a parked call is a promise something awaits. `ChatRoutes.inspect()`
  reports what is still held so a test can tell the two apart, and shutdown
  disposes the turns it fails rather than leaving them to a timer nobody will
  see. It settles the union of parked turns, resume holds and whatever the
  call registry still names — a resuming turn is deliberately taken *out* of
  the parked map while its deadlines are suspended, so walking that map alone
  left a live session whose calls had no timer left to settle them.
- **A tool result belongs to one turn, or to none.** The parked-call registry is process-wide, so a follow-up releases only the calls the turn it resumes actually owns. A follow-up whose results name no live turn is refused with `400 StaleToolResults`; starting a fresh turn instead drops the result the client just produced and lets the model redo the work behind its back. The correlation is resolved twice — once to answer fast, once inside the queue slot — because a request can wait there for as long as another turn may run, and **both** of the turn's deadlines — the turn-level one and the shorter per-call one in the registry — are suspended for as long as its own resume is waiting. They ask the same question, so a fix that suspends one and not the other only moves which timer loses the result.
- **One turn at a time is an invariant, not a hint.** A request past its deadline is cancelled through an `AbortSignal` and the queue keeps holding the slot: a task still running has not left the single-flight boundary, whatever its caller was told. If it will not stop, the queue refuses requests with `503` and names it rather than starting a second turn beside it.
- **A browser origin is refused unless it is allowed.** The proxy listens on loopback and runs an agent, so a wildcard `Access-Control-Allow-Origin` would let any page spend a turn — a missing response header does not stop a simple request. `ALLOWED_ORIGINS` defaults to the extension schemes; a request with no `Origin` is not a page and is left alone.
- `packages/olc/README.md` has the options, endpoints, build outputs and known limits.

### Browser sessions and capture

- Chromium Agent debugger attachments belong only to
  `src/background/agent/agent-browser-session-manager.ts`. Raw CDP targets stay
  inside that adapter and never become model tools. This is a rule about
  extension code: `chrome.debugger` attachments taken against the user's tab
  in the shipped product. It does not reach `tools/verify/**`, where a Node
  runner drives Chromium's own DevTools endpoint from outside the extension
  to kill and restart the worker — the thing under test cannot own the switch
  that kills it, and nothing there ships or is reachable by a model. Attach only after the run
  service authorizes the user-selected tab; detach at pause, takeover, stop,
  completion, and failure boundaries. An unexpected disconnect pauses the run,
  and an interrupted effect remains unresolved rather than being replayed.
- Firefox receives no `debugger` permission. The session manager reports the
  existing DOM control backend with `cdpControl: false` and
  `frameTracking: false`; do not claim CDP-only capabilities there.
- **Identity is per frame.** `AgentSnapshotIdentity` names a tab, a frame, a
  document and a generation; every frame keeps its own reference store, and a
  child frame's references carry the frame in their prefix (`f7e2`), so `e1`
  is never the same control in two frames. The command names the root
  snapshot; the executor binds the effect to the target's own frame identity
  (`target.frame`) and re-reads that frame's document before acting. Never
  hardcode `frameId: 0` again — a literal zero is how a child-frame control
  gets resolved against the wrong document.
- **A frame is read only once the run may read it.** The registry lists the
  tab's frames, and each child passes the browser's limits, the user's
  exclusions and the run's origin allowlist before its port is opened. A frame
  that fails any of them is listed in `observation.frames` with its origin and
  the reason, never its URL, and contributes no elements; the model is told it
  exists so it can ask rather than conclude the control is missing.
  `about:blank` and `srcdoc` frames have no origin and are omitted.
- **Frames and elements are bounded together.** Root first, then children in
  frame-id order up to `MAX_AGENT_OBSERVED_FRAMES`; frames past the cap are
  counted in `omittedFrames`, never listed, so the list itself honours the
  contract. A child receives only the element budget the frames before it
  left, and a child that cannot fit or cannot be read is listed as such rather
  than truncated or retried.
- **Perception reads the composed tree, not the light DOM.** Candidate
  selection and both text walks descend into open shadow roots at their host,
  so a component's controls and text are observed like any other; every node
  tree is walked once, so a `<slot>` never double-counts the light child it
  projects. A closed shadow root reads as `null` and stays unread rather than
  guessed at. The walk is `nodeType`-based, not `instanceof Element` — the same
  observation runs against a child frame's own realm.
- **A covered control is not a clickable one.** A laid-out, in-viewport element
  whose click points all hit-test to some unrelated element is marked
  `occluded`; it is still listed — the control exists — so the model dismisses
  the cover or scrolls rather than clicking a point the pointer cannot reach.
  An indeterminate hit test (no layout, or a `null` answer) reports no
  occlusion: a covered control wrongly shown is recoverable, a reachable one
  wrongly hidden is not.
- **The page is one budget claimant, not the whole prompt.** The context
  window is partitioned across instructions, tools, history, output and page
  content (`agent-model-port.ts`); the page gets the remainder and is projected
  to fit it. A large application does not send every control — the overview
  keeps the focused control, the reachable ones and whatever fits in document
  order, and reports the rest in `omittedByGroup` so a control the budget
  dropped is discoverable, not silently absent. No budget preserves the whole
  projection.
- **A bounded overview is drilled into, not scrolled through.** Three read-only
  commands reveal what the overview summarised: `inspect` expands a region by
  its group, `find` surfaces controls matching a query, `extract_text` returns
  the page's full text — the below-fold document the overview omits. None
  mutates the page, so all resolve as `read` and ask no approval. What to expand
  is derived from the previous step's own durable command
  (`currentAgentInspection`), so the next observation shows exactly what was
  asked and a worker restart rebuilds it — no separate run state. An expansion
  is still bounded by a hard ceiling (`pageContentMaxChars`, set from the
  context ceiling), so a two-thousand-control region or a maximal text extract
  cannot push the prompt past the window and truncate the system prompt.
- **A read-only request that matched nothing says so.** A region is matched by
  the exact group name the observation publishes — `page` included, which is
  the name omissions outside any landmark are reported under and was for a
  while the one published region that could never match. A miss is reported as
  `unmatched`, with the regions the page does have, because the answer to a
  misnamed region is otherwise byte-identical to the answer to a real one and
  a model has no way to learn: one run spent twenty-one of its twenty-five
  observations asking for the same absent region.
- **A confirmed step is not the same thing as progress, and the no-progress
  guard must not be told otherwise.** It failed to fire on a run that repeated
  one request twenty-one times, and the reason was that idea written down
  three separate times:
  - `classifyNoProgress` required an identical observation hash. A changed
    page is normally proof the run got somewhere, but that does not hold for
    `inspect` and `find` — the run changed nothing, so the page moving is not
    its progress, and a live application moves between every pair of
    observations. Those two are compared on url and decision alone. `read` and
    `extract_text` keep the hash test, because for those the observation *is*
    the answer and a changed page is a different answer.
  - The controller cleared the guard's memory after every confirmed
    verification. A pure read verifies `confirmed` by definition, so a repeat
    could never accumulate. It is cleared on `agentEffectChangesPage(effect)`
    now — navigation needs no exemption, since going somewhere changes the url
    the guard compares first.
  - `classifyNoProgress` took a `verificationOutcome` input that reset the
    count on `confirmed`. Nothing ever passed it, and wiring it as written
    would have made the loop unkillable. It is gone; do not reintroduce it.
- **A refused command is told to the model, not made fatal.** The resolver
  refusing to ground a command means nothing was attempted, so the run has
  lost nothing: it records a rejected step carrying the affordance layer's own
  sentence — assembled from templates and the model's ref, never from page
  text — and looks again, exactly as a declined completion does. Three
  consecutive refusals fail the run with `command_refused`, whose advice says
  the model kept naming controls the page does not offer. Failing on the first
  one answered a well-formed decision with `invalid_decision`, whose advice
  tells the user to find a larger model — wrong about what happened, and often
  wrong about whose fault it was, since a control the observation offered can
  be gone by the time the resolver reads the page.

  Most refusals never reach the resolver: `agent-decision-parser.ts` asks the
  same classifier the same question of the same observation, where a wrong
  answer costs one retry instead of a step. What reaches the resolver is what
  that check cannot see — a live hit test, a dialog that opened, a screenshot
  that is no longer there.
- **A finding outlives the history window.** `finding` on a decision is kept in
  a dedicated store (`buildAgentFindings`), bounded by count and bytes, carrying
  the redacted page each was recorded on. It is the run's own note and stays
  untrusted page-derived data, never an instruction, so a fact learned on step
  two survives to step fifty without letting the page it came from change the
  goal.
- **A child-frame effect happens on the frame's origin.** The resolver sets
  `frameUrl`/`frameOrigin` for a target outside the root frame; policy judges
  grants, grant offers and sign-in/payment paths against those, while
  `sourceUrl` stays the page the tab shows and history records.
- **The debugger's frame tree is tracked, not guessed.** After attach, the
  session manager enables `Page`, flattens auto-attach for out-of-process
  frames, and follows frame events on every session. `mapFrame` joins an
  extension frame onto that tree only when the join is exact — the root, or
  the single frame under the mapped parent with that URL. Ambiguous siblings
  and unknown parents are reported as unmapped; a command aimed at a guessed
  frame is an effect nobody approved.
- **Tab scope is a run's, not a site's.** `scopedTabIds` holds the tab the
  user started on and every tab the run opened itself; `switch_tab` to any
  other tab raises an approval whatever the site allowlist says, and the tab
  joins the scope in the same claim that moves the run onto it. The debugger
  attachment follows the controlled tab in that write, before any page work
  is claimed there.
- **Native input is chosen before the action and never swapped after it.**
  `chooseAgentInputBackend` (`native-input.ts`) decides `cdp` or `dom` from the
  command, the resolved target and whether the run holds the tab's debugger
  and can place the target's frame. Link activation, form submission,
  Enter-on-a-submitting-field and a newline typed into one stay on the
  guarded DOM paths whatever is attached — those paths exist so page handlers
  cannot redirect an approved destination, and a native click or Enter would
  hand it back to the page. A chord on a character the key table cannot press
  has no native form and goes to the DOM path too. Once a
  native step has been sent, a failure is an unresolved effect; it is not
  completed through the content script. Only a plan the debugger refused from
  its first step is a clean `AgentEffectNotAppliedError`.
- **A native plan is a sequence the runner owes a release for.**
  `runAgentNativeInputPlan` sends one step at a time, checks cancellation
  between steps, and on abort or dispatcher failure releases every held button
  and key (reverse order) before throwing with the count dispatched. It never
  re-sends a step. `Input.*` and `DOM.*` method names live only in the session
  manager, behind `nativeInput(runId, tabId)`; the planner speaks in steps.
- **The page picks the point, the debugger places the frame.** Preparation
  (`prepareAgentNativeInputInDocument`) runs the same target guards as
  synthetic execution, scrolls the element into view, takes the first
  hit-testable point from the occlusion sampler, and arms an input record —
  all in one synchronous pass. Coordinates are the frame's own viewport
  pixels; the background adds the frame's root offset from the debugger's
  frame tree (`DOM.getFrameOwner` + `DOM.getBoxModel`, one hop per session),
  so a child document cannot steer a click by misreporting where it sits.
- **Delivery is matched, not assumed.** The page records trusted
  `mousemove/mousedown/mouseup/keydown/keyup/wheel` while a plan is in flight;
  `assessAgentInputDelivery` matches the record against the plan. A
  state-changing event the plan did not send is `interference` (a real hand on
  the page), and the verifier pauses the step as unresolved rather than
  crediting or retrying it; stray `mousemove`s are ignored because the browser
  synthesizes them after layout. A key's release is not judged for target —
  after Tab it lands on the next control. `misdirected`, `partial`,
  `undelivered` and `unknown` (the document navigated before it could answer,
  or the plan was inserted text with no events to match) are told apart on
  the receipt. Native and user events are both trusted, so this is the only
  discriminator there is — a user event that exactly matches the plan is
  indistinguishable, and the limitation is stated rather than papered over.
- `double_click` and `hover` are element actions in the DOM-mutation family;
  `press_key` accepts chords (`Shift+Tab`, `Control+a`) through the grammar in
  `packages/contracts/src/agent-keys.ts`. Select-all and move-to-end travel as
  CDP editing commands, not platform shortcuts, so a plan is the same on every
  OS. Native `<select>`, `check` and `uncheck` stay synthetic: a native option
  popup cannot be driven, and a checked state is stated, not toggled.
- Firefox has no debugger: `double_click` and `hover` degrade to synthetic
  events there, the receipt says `backend: "dom"`, and the hover verifier
  then needs page evidence, since no delivery record exists.
- **An editor is edited through the browser's own editing pipeline, never by
  writing its DOM.** A `contenteditable` host is observed as a control of type
  `contenteditable` whose value is its flattened text; `type` appends,
  `clear_and_type` replaces all, and `replace_text` replaces one exact
  occurrence of `find`. The page-side helpers (`editor-page.ts`) place the
  selection or caret and drive `execCommand`/`insertText`, so a rich-text
  editor that rebuilds its DOM from its own model keeps the change. Value
  comparison flattens markup the one way every side does (`editor-text.ts`), so
  a paragraph rendered as `<p>` on one read and `<div><br></div>` on the next
  is not a spurious change. Typed text never presses Enter — a newline is
  inserted as a line break, allowed only in a `multiline` field — because Enter
  is a submission or send that `press_key` must choose on purpose.
- **A drag is grounded on both ends and verified by the arrangement it
  leaves.** `drag` names a source `ref` and a destination `to`, both observed
  and in one frame; the destination is rechecked before the pointer moves. The
  native channel presses on the source and, if a held move makes the browser
  start an HTML5 drag (`Input.dragIntercepted`), drives it with drag events and
  drops with the drag data — otherwise the move stays a pointer drag a
  library reads. A stopped drag is cancelled, never dropped. The verifier
  confirms only a changed arrangement — the item moved past its destination,
  into another region, among different neighbours, or off the page — never the
  page merely having changed. Firefox and the DOM backend send the synthetic
  pointer-and-HTML5 sequence in `drag-page.ts`.
- **A file chooser is the user's, and the debugger holds it back.**
  `Page.setInterceptFileChooserDialog` is enabled on attach, so a click on a
  file input opens nothing; the run records `file_selection`, policy raises a
  `file_upload` takeover, and detaching for the takeover lets the user's own
  click open the chooser. A chooser the page opened mid-action is reported on
  the receipt (`fileChooser`) and settles the step as the user's whatever else
  happened.
- **A native dialog holds the page, and only the debugger can see it or let
  go of it.** Enabling `Page` is what makes `alert`, `confirm`, `prompt` and
  `beforeunload` reach `Page.javascriptDialogOpening` instead of the user, so
  an unanswered one is a tab frozen for as long as the run holds it. The
  session manager records the held dialog with an id minted from a
  never-resetting counter (`openDialog`), and `release` dismisses whatever is
  still held before detaching — dismissal confirms nothing and keeps a
  `beforeunload` on the page, and detaching for a takeover is what lets the
  user's own click raise a fresh dialog.
- **A blocked page is observed as blocked, not asked.** A dialog blocks the
  document's script, so no control port can answer: every observation the run
  takes goes through one seam in `agent-browser-adapters.ts`, which reports
  the tab, the dialog and a root frame marked `unreadable` — no elements, no
  text — rather than waiting on a page that will not reply. Its generation
  follows the last real observation and its snapshot names the dialog, so a
  command grounded in it cannot be replayed against the page afterwards. The
  verifier shares that seam, so a second dialog cannot leave it waiting
  either.
- **A dialog belongs to the document that opened it, not to the tab.**
  `Page.javascriptDialogOpening` names that document, which is the only way to
  tell the page's own `confirm` from an embedded frame's — and a frame's
  dialog blocks the whole tab either way. The origin travels on
  `AgentDialogState`, a document with none of its own (`about:blank`, `srcdoc`,
  an unreadable URL) is recorded as `"null"` so no allowlist matches it, and
  the adapter withholds `message` and `defaultPrompt` for an origin outside
  the run's allowlist — a dialog's text is frame content, governed by the same
  authorization as a frame's elements. The run is told the dialog exists, on
  which origin, and that it could not be read (`unauthorizedOrigin`), because
  a prompt it cannot see is different from one that is not there. The resolver
  sets `frameOrigin` for such a dialog, so policy judges the answer, its grant
  offer and its allowlist against the site that asked.

  The document the tab shows is the exception to the withholding, and
  deliberately: `observeRoot` is not allowlist-gated either — the root frame
  is the page the user pointed the run at, and `allowedOrigins` governs where
  the run may travel and act, not what the page in front of it may say — so
  withholding an `alert` from a page whose whole body text is already
  readable would be a stricter rule for the box on top than for the page
  under it, and would blind the run to a legitimate dialog after any redirect
  it did not itself approve.
- **Answering a dialog is priced against the origin that raised it, root
  frame included.** Reading one and answering it are different questions.
  Every other effect on an unapproved top-level origin already costs an
  approval by its own class — an activation is high whatever page it is on —
  but a dismissal is low, so a page that navigated itself somewhere the run
  never approved would otherwise have its dialogs answered for free.
  `baselineRisk` therefore raises a `handle_dialog` on any acting origin
  outside the allowlist, and the approval names that origin rather than
  calling it "the page".
- **A dialog is answered by identity, in its own action family.**
  `handle_dialog` names the `dialogId` the observation listed; `resolve`,
  `execute` and `verify` live in the `dialog` family, and the executor checks
  the tab but never the document. An answer whose prompt is no longer the one
  held is an `AgentEffectNotAppliedError`, never an answer given to whatever
  replaced it. Every other command is refused while a dialog is open
  (`dialog_open`, in `assertLiveObservation` so no family can forget it), and
  the classifier refuses the same thing at parse time so it costs a retry.
  Dismissing is allowed; closing an `alert` is allowed, because a run that had
  to ask could not get past one. Accepting a `confirm`, `prompt` or
  `beforeunload` carries `destructive` — critical, never grantable — because
  the page's own words are the only clue to what it commits to.
- **Submission is priced where it happens, not from the target's shape.**
  `maySubmit` says a control sits on a submit path, which is true of every
  field in a single-input form; pricing it as critical made each character
  typed into a search box an ungrantable prompt and trained the user to
  approve without reading. The `submission` class the resolver attaches to a
  click on a submitter and to Enter in a field that submits on it is what
  costs critical. Typing is a `form_mutation`, which is grantable per origin.
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
- **Input delivered, effect observed and goal achieved are three answers, and
  a run owes all three.** The receipt's `inputDelivery` says the page received
  the events; the verifier's outcome says the control changed as the step
  intended; neither says the thing the user asked for is true. Clicking Save
  is an activation a verifier confirms — the button was pressed, the page
  changed — while the document is still saving, so `complete` used to let
  every run that pressed the right button report success.
  `judgeAgentCompletion` (`completion.ts`) is the third answer: a run that
  changed anything must cite evidence, and that phrase has to be in the
  observation it decided on, read by the same matcher `wait` uses
  (`observed-text.ts`) so a run cannot complete on evidence its own wait would
  reject. A run that only read owes none — what it read is its answer.
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
  restart the interrupted step is `uncertain`, which the unverified-change
  rule refuses before evidence is reached at all.
  A step is appended once per lifecycle change, so the judge collapses
  receipts to the last one per step before selecting, the way history does: a
  superseded `executed` receipt for a step that went on to fail is an applied
  change with no verification, and would refuse every completion after it. Receipts that
  cannot be read are an unknown, never an empty history — reading them as
  "changed nothing" is the hole the gate exists to close. A refusal is a safe
  failure: nothing was attempted, so it is recorded as a rejected step and the
  run looks again, with the reason reaching the next decision through its own
  history, and a model that keeps claiming the same thing exhausts the
  no-progress budget like any other repetition. `deciding -> observing` is a
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
- **A real terminated worker is the only proof of recovery.**
  `pnpm verify:sw-agent-recovery` leaves a run durably `executing` with its
  step open, kills the worker through DevTools while the extension page and
  the offscreen SQLite owner keep running, and requires the replacement
  worker's own startup recovery to settle it: the step `uncertain`, the run
  `paused` for an unresolved effect, and no second step — a second step would
  mean the effect was reissued. The unit smoke test proves the SQL settles a
  run already in that state and cannot prove a terminated worker reaches it.
  Seeding walks the real state machine (a run may only be created
  `submitted`, and entering `executing` copies the planned receipt into an
  execution claim), in a loop, because a worker booting mid-seed runs the very
  recovery being measured and pauses the run out from under it.
- **A screenshot is an observation's companion, never a record.** The
  controller pictures the tab (`AgentScreenshotPort`) only after the DOM
  observation is in hand and only for a model whose `vision` the model port
  resolved from the same evidence chain as tool calling; text-only models are
  offered no `click_point`/`zoom` and cost the page no capture. The picture
  carries the observation's snapshot identity and scroll, travels as the user
  message's image attachment, and is held for that decision and the resolution
  that follows — never persisted, logged, traced or shown. A capture that
  fails leaves the decision to the DOM; it never fails the run.
- **Nothing leaves unmasked.** `screenshot-capture.ts` asks the page for
  every region a picture must cover (`agent_sensitive_regions`): each sensitive
  control in the *whole composed tree* — never the bounded observation, which
  stops at its element budget — and every child frame, masked whole because a
  frame the run cannot read may hold a sign-in form and one it can read cannot
  be placed from the root. Regions are read at the observation's scroll
  position, then read again after the capture; any difference means the page
  moved under the picture and the step gets none. Masks are painted black in
  image pixels with a one-pixel margin and the long edge is bounded to
  `MAX_AGENT_SCREENSHOT_EDGE_PX`. The editor is the worker's `OffscreenCanvas`;
  without one there are no screenshots.
- **The fallback capture is the active tab's or nobody's.**
  `tabs.captureVisibleTab` pictures whichever tab is active in a window, so the
  debugger-less path (`visibleTabCaptureSource`) requires the controlled tab to
  be that tab immediately before and after the capture and returns nothing
  otherwise — a neighbouring tab stamped with this tab's identity would be
  masked for the wrong page.
- **Screenshots need their own acknowledgement, and the runtime enforces it.**
  `AGENT_REMOTE_SCREENSHOT_ACKNOWLEDGED` is separate from the observation
  acknowledgement. The panel shows the screenshot variant of the remote notice
  whenever pictures *may* travel — vision true or not yet determined — and
  `buildAgentController` refuses to picture a remote provider's run until the
  setting is set, whatever the panel showed at start. A local endpoint needs
  no acknowledgement; nothing leaves the device.
- **Coordinates convert through the picture's own geometry.** A screenshot
  records the CSS `region` it shows and its `scale` (image px per CSS px);
  `screenshot-geometry.ts` converts a model's image pixel to the root layout
  viewport point and back, which is how device scale, browser zoom, pinch zoom
  (`cssVisualViewport`) and a `zoom` crop all reduce to two numbers. `zoom` is
  read-only inspection: the next capture is a clip magnified to the zoom and
  edge caps, converted by the capture port from the geometry it remembered in
  memory — a restart forgets it and captures the whole viewport again.
- **A visual click is a click on the control under the point.** `click_point`
  resolves by asking the page what lies under the converted CSS point
  (`agent_hit_test`): the nearest listed control that contains the hit, else
  the hit element newly referenced into the live snapshot and observed like
  any other. Every click rule then applies — sensitive input, links,
  submitters, checkboxes — and only "not an activatable control" is waived,
  because a canvas is what a point exists to reach. A point inside a child
  frame is refused; the frame's own refs name its controls. A stale picture
  cannot authorize a click: the screenshot must carry the command's snapshot
  and generation and the observation's scroll, and the executor re-hit-tests
  the point before anything is sent, refusing a control that moved.
- Disclosure says whether pictures travel: `AgentProviderDisclosure.screenshots`
  is resolved from model vision, memoized per model, shown as unknown when it
  could not be determined, and switches the remote-provider notice to the
  variant that names screenshots.
- Read-only helpers: `src/lib/browser-sessions.ts`. Model tools: `src/lib/tools/internal/browser-session-tools.ts`.
- `sessions` is an optional permission. Always check browser support **and** the live permission before reading recently-closed or synced-device sessions.
- Session URLs must pass the same unreadable/never-read filters as other browser tools.
- Do not expose `sessions.restore()` to a model until tool execution has a real interactive approval boundary.
- `tabCapture` + `offscreen` is a Chromium 116+ prototype. Any capture flow must start from a user gesture, preserve tab audio, show persistent recording state and a Stop control, stop on permission revoke, and keep data ephemeral until explicitly saved.

## Conventions

### Messaging keys

- **Do not add a request/response runtime message — add an `RpcMethod`.** Since `0.12.5` every provider, model and embedding round trip goes through `src/protocol/`. `MESSAGE_KEYS` keeps only streaming port names, one-way events, and `PROVIDER.GET_MODELS` (the single content-script-reachable read, outside the protocol because the RPC envelope is extension-page-only by policy).
- `MESSAGE_KEYS.OLLAMA.*` is two port names (`STREAM_RESPONSE`, `PULL_MODEL`). Do not add to `LEGACY_OLLAMA_MESSAGE_KEYS` — the legacy twins were deleted because a page old enough to send one already has an invalidated extension context.
- `STORAGE_KEYS.PROVIDER.*` vs `LEGACY_STORAGE_KEYS.OLLAMA.*` is different: storage keys name persisted data, so those legacy strings are real.

### Background handlers

`src/background/handlers/handle-{action}.ts`, registered in `src/background/index.ts`. Only streaming/port work belongs here (chat, context build, pull, selection actions, embedding download); request/response provider and model operations live in `ProviderRpcService` / `ModelRpcService`. Keep handlers thin — adapt the port protocol to `src/lib/` and stream back.

A handler that only *writes* a stream takes `ChatStreamSink`, not `ChromePort`: `name` + `postMessage` plus the optional `abortScopeKey`/`streamSequence` is the whole surface a producer uses, and a real port satisfies it structurally. The durable turn runtime consumes the same stream in-process, so it needs a sink rather than a fabricated port. `withErrorContext` is generic over the port type and defaults to `ChromePort`, so handlers that need a connection keep it. The one remaining `as unknown as ChromePort` is in `port-router.ts`, adapting a real `browser.Runtime.Port`, and a boundary test keeps it the only one.

### Component layers

Four tiers, and the tier decides the rules:

1. `src/components/ui/` — vendored shadcn primitives, curated. Check whether an existing primitive or a small composition works before adding one.
2. `src/components/{settings,actions,feedback,forms,layout}/` — app-owned composites.
3. `src/features/<x>/components/` — feature UI.
4. `src/sidepanel/`, `src/options/` — shells.

- **A component with no importer outside its own layer is speculative.** Add the second real caller in the same change, or don't add the component.
- **The options-page composites do not fit the side panel.** `SettingsRow` is `p-3 text-sm` with breakpoints, built for ~900px; the side panel is ~400px and dense. Reach for a dense primitive rather than hand-rolling a smaller copy of a page-sized one.

### Component name suffixes

The suffix names what a component *renders*, not how important it feels. Match it to the root element when adding or restructuring.

| Suffix | Renders |
|---|---|
| `*-card.tsx` | its own bordered surface as the root (`Card`, `SettingsCard`) |
| `*-section.tsx` | a titled group with no surface of its own |
| `*-fields.tsx` | a bare group of form fields — fragment root, no title, no surface |
| `*-panel.tsx` | a feature's whole composed surface, arranging its own cards and sections |

### Dense list rows

Side-panel rows shaped *leading glyph → label → trailing action* go through `ListRow` / `ListRowButton` (`src/components/layout/list-row.tsx`). Do not rebuild the grid — hand-rolled copies are why one sheet had leading edges at 8/16/18/26px.

- `ListRow` is a `div`, for rows whose title and trailing control are separate hit areas.
- `ListRowButton` is the same geometry on a `<button>`, for whole-row targets.
- `inset="nested"` inside an already-padded scroll container.
- `trailingKind="control"` when the trailing slot ends in a hit-area that pays its own padding.
- `description` for a second line of the row's own label; `below` for a second line owning its own content.
- `EmptyState` needs `density="compact"` in a dense list.

### Icons

- Import from `lucide-react` directly. There is no re-export barrel — `@/lib/lucide-icon` was retired because tree-shaking already dropped unused icons through it and nothing enforced it as an allowlist.
- `LucideIcon` is a type export of `lucide-react`. There is no `CheckIcon` — use `Check as CheckIcon`.
- `src/components/__tests__/design-system-contract.test.ts` requires named size tokens (`icon-sm`, `icon-xs`, …) on Lucide components, not raw `size-4`, and bans `text-[…]` and `rounded-md`/`rounded-lg` repo-wide.

### React Hook Form fields

Use the `Controlled*` wrappers in `src/components/forms/`. **Never spread `register(...)` into a `src/components/ui/*` primitive** — several are controlled Base UI wrappers, and spread-register can leave the DOM looking updated while RHF holds the old value. `src/components/forms/__tests__/react-hook-form-contract.test.ts` enforces this for production TSX without enumerating wrapper names.

The set is `ControlledTextarea`, `ControlledNumberInput`, `ControlledSlider` — what the one RHF form (`model-settings-form.tsx`) binds. Others were deleted for having no caller; recover them from git when a form needs one.

### Settings search and deep links

`src/features/settings/settings-registry.ts` is the source of truth. When adding or moving a setting:

- Add or update the entry with the real tab, section, label key, description key, and visible child strings in `searchKeys`.
- Prefer i18n keys over keywords. Use `aliases` only for technical synonyms, provider names, or common typos that are not visible copy.
- Every `id`/`focusId` must resolve to a mounted element via `focusId`, `id`, or `data-settings-focus-id`. Use the focus props on `SettingsCard` / `SettingsFormField` / `SettingsSliderField` / `SettingsSwitch`, or add `data-settings-focus="true"` plus `data-settings-focus-id="…"`.
- No duplicate focus IDs across tabs — duplicates land highlights on the wrong control after navigation.
- Update `settings-registry.test.ts` / `settings-search-index.test.ts` or the component test.

### i18n

`src/locales/<lang>/translation.json` is the source of truth for both in-app copy and extension package metadata. Nine locales: `de en es fr hi it ja ru zh`.

- Loaded through the explicit dynamic-import map in `src/i18n/locale-loader.ts`, one lazy chunk per language. Do not build an aggregated all-languages resource.
- **Never pass a fallback string to `t()`.** Add the key to every locale instead.
- Keep the top-level `extension` block filled in for every locale.
- `public/_locales/**/messages.json` and `public/assets/selection-locales/` are **generated** by `tools/generate/generate-i18n-resources.ts`. Do not hand-edit them. `_locales` is committed because extension packages need it.
- Generation runs before `dev`/`build`/`package`, not on install, so run `pnpm generate:resources` manually after a locale edit to validate the catalogs.
- Before adding a key, check for an orphan that already fits — `tabs.select.ready` sat fully translated and unused.

### Testing

- Vitest with `happy-dom` and `fake-indexeddb`. `src/test/setup.ts` mocks chrome APIs and IndexedDB.
- Tests live in the nearest `__tests__` directory under `src/`, `packages/`, `config/` or `e2e/`. Never beside production modules.
- Single file: `pnpm test src/path/to/module.test.ts`.
- Coverage includes `.ts` and `.tsx`: UI components, type modules and barrels count. Tests, declarations, and explicit browser-only composition roots/harnesses are excluded in `vitest.config.ts`. Existing `.ts` thresholds and the newly measured `.tsx` baseline are gated separately; see `tools/README.md`.
- `@testing-library/user-event` is **not** a dependency — use `fireEvent`.
- When a change breaks an existing test, work out whether the test or the change is wrong. A broken assertion is sometimes the design talking: a fan-out that consumed a queued fetch response failed the Ollama contract test, and the predicate was the bug.

Contract tests worth knowing about, because they enforce conventions no reviewer would catch:

| Test | Enforces |
|---|---|
| `components/__tests__/design-system-contract.test.ts` | icon size tokens, typography/radius tokens |
| `components/forms/__tests__/react-hook-form-contract.test.ts` | no spread-`register` |
| `lib/providers/__tests__/contract.test.ts` | provider list/stream parsing |
| `lib/__tests__/architecture-boundaries.test.ts` | chat-history goes through the facade; SQLite internals stay out of UI; one SQLite engine; no row-collection casts |
| `lib/__tests__/browser-api-contract.test.ts` | guarded browser API access |
| `config/__tests__/manifest-csp.test.ts` | no dev origin in a packaged CSP |
| `config/__tests__/test-layout.test.ts` | every test/spec stays in a `__tests__` directory |
| `config/__tests__/documentation-comments.test.ts` | module/declaration prose uses JSDoc instead of `//` blocks |
| `config/__tests__/wxt-build-config.test.ts` | which dev pages and WASM assets a store build carries |
| `config/__tests__/package-versions.test.ts` | workspace packages carry the extension version |

### Lint and formatting

- Biome, not ESLint/Prettier: 2-space indent, LF, double quotes, no semicolons (except ASI hazards), no trailing commas, bracket-same-line JSX.
- `__tests__/` may use `noExplicitAny`. Vendored shadcn a11y suppressions are per-line comments in the offending file — there is no blanket override for `src/components/ui/**`.
- Biome rewrites some Tailwind arbitrary values to canonical form (`row-end-[-1]` → `-row-end-1`) and enforces exhaustive hook dependencies, so a `deps.join()` trick fails — memoize instead.

### Git hooks (`.husky`)

Branch promotion has three stages: `release/*` → `preview` → `main`. Merge a release branch into `preview`, validate it there, then merge `preview` into `main`. Do not promote a release branch directly to `main`.

- `pre-commit`: lint-staged (Biome fixes on staged files and `test:related`) → one full `typecheck`. **Does not run the full suite.**
- `pre-push`: production dependency audit → `pnpm verify` (shared static checks and full tests) → `package` + `bundle:check` for both browsers, because a bundle budget can only be measured against a real build and finding out from CI costs a whole round trip. Browser automation, docs and release gates still belong to CI / `verify:release`.
- `tools/README.md` documents command ownership and prerequisites. `check:static` is shared by CI and local verification; `verify:ci-parity` runs static checks and coverage on committed HEAD in a clean worktree.
- Never bypass with `--no-verify`. If a hook fails, fix the cause.

## Agent supervision surface

- **The browser's own limits are disclosed before a run, not after it
  stalls.** `AgentBrowserDisclosure` travels on every panel snapshot, read
  from the session manager rather than guessed from a user agent, and the
  panel names what attaching means — Chromium shows its own debugging banner
  the moment a run attaches, and a banner with nothing beside it is what
  sends someone to ask a developer. A browser with no debugger states what it
  therefore cannot do: synthetic input only, no screenshots, no native
  dialogs.
- **A failure leads with the recovery.** `AgentError.message` is written in
  English for whoever reads a receipt and says what happened; the panel shows
  `agent.failure.<code>` first, in the reader's language, and keeps the
  original beneath so the words the run used survive for a bug report. A code
  with no key falls back to the `unknown` advice rather than to nothing.
- **Supervision needs the action and the ceiling.** The status is the
  machine's word for it, so the panel also names the step in flight — the
  same label the work log uses, so the two cannot disagree — shows progress
  against the observation budget that will stop the run, and counts every tab
  the run drives once it has adopted more than the one it started on.
- Panel copy is i18n like everything else: every key exists in all nine
  locales, and `pnpm generate:resources` runs after a locale edit.
- **A run's record comes out as text, in a dev build.** From the background
  DevTools console: `await __agentReport()` for the run that ran last,
  `await __agentReport("run-id")` for a particular one, `copy(await
  __agentReport())` to the clipboard. It returns the durable record — every
  step's command and its fields, the verification outcome and summary, the
  failure's code — because a screenshot of the work log has statuses and none
  of those, and diagnosing a run from pictures loses exactly what says where
  it went wrong. `globalThis.__OLLAMA_CLIENT_AGENT_TRACE__ = true` is the
  other half: structural phase lines for the rest of the worker lifetime.
  The dump is compile-time absent from store builds (`__AGENT_DEBUG_REPORT__`)
  because the record quotes page text. `pnpm dev` carries it; a production
  build does not, so testing against one means `pnpm build:debug` — the same
  output directory, the same production bundle, with the dump kept. Only
  `WXT_AGENT_DEBUG=1` turns it on, so a release build cannot acquire it by
  forgetting a flag.

## Measured agent behaviour

`AGENT_EVALUATION.md` holds the published numbers and the named remaining
failures; regenerate it from the two benchmark projects rather than editing
the tables by hand.

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

## Constraints

- MV3 CSP blocks dynamic eval; WASM is allowed via `'wasm-unsafe-eval'`. ONNX Runtime is bundled, never fetched.
- Firefox lacks Chrome's `declarativeNetRequest` semantics. Cross-origin provider requests rely on `host_permissions: ["<all_urls>"]` plus CORS-friendly endpoints.
- Provider model-name collisions make routing ambiguous. `ProviderFactory` resolves via the saved mapping first, Ollama fallback last.
- Token budgeting in `lib/embeddings/chunker.ts` is approximate (`chars / 4`).
- A dev build emits no chunks to disk beyond the reload shim; everything is served from the Vite dev server, so `chrome.runtime.getURL` is unavailable for dev-only asset paths.

## Provider API reference

- **Ollama** — <https://github.com/ollama/ollama/blob/main/docs/api.md>
  - `/api/tags`: list. Omits family/parameter_size/quantization for non-GGUF models.
  - `/api/show`: full metadata, `capabilities[]`, `model_info` including `general.parameter_count`.
- **LM Studio** — <https://lmstudio.ai/docs/developer/rest/endpoints>
  - `/api/v0/models`: `type`, `publisher`, `arch`, `compatibility_type`, `quantization`, `state`, `max_context_length`, `capabilities[]`. **No size of any kind**, here or on `/api/v0/models/{id}`.
  - `/api/v0/chat/completions`: chat. Standard OpenAI-compatible endpoints also work; `/v1/models` returns only `id`/`object`/`owned_by`.
- **llama.cpp** — <https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md>
  - `/v1/models`: includes `meta` with `size` and `n_params`.
  - macOS model cache: `~/Library/Caches/llama.cpp`. Example: `llama-server -m ~/Library/Caches/llama.cpp/<model>.gguf --port 8000 --host 0.0.0.0`
- **OpenAI** — <https://platform.openai.com/docs/api-reference>
- **Anthropic** — <https://platform.claude.com/docs/en/api/messages/create>
- **vLLM** — <https://docs.vllm.ai/en/latest/serving/openai_compatible_server.html>
- **KoboldCPP** — <https://github.com/LostRuins/koboldcpp/wiki>
- **LocalAI** — <https://localai.io/features/openai-functions/>
- **SearXNG** — <https://docs.searxng.org/dev/search_api.html>
- **Brave Search** — <https://api-dashboard.search.brave.com/app/documentation/web-search/responses>
- **Tavily** — <https://docs.tavily.com/documentation/api-reference/endpoint/search>
- **OpenCode** — <https://opencode.ai/docs/> (server API and plugins; used by `packages/olc`)

## Current state of known hotspots

What these files are *now*, so you neither go looking for a god-object that was already split nor assume a large file is fine.

**Do not restructure incrementally:**

- `src/features/chat/hooks/use-chat-turn-controller.ts` — owns UI submission preconditions, session/message preparation, and durable turn command construction. Boundary cleanup is tracked in `RELEASE_ROADMAP.md`. Keep `use-chat.ts` as wiring only.

**Open for incremental work:**

- `src/features/file-upload/hooks/use-file-upload.ts` — still owns UI state around ingestion; pipeline helpers are in `file-upload-pipeline.ts`. Keep moving validation, registration and embedding enqueue out of the hook.

**Already restructured — match the existing shape rather than reverting to props or god-objects:**

- `src/features/chat/hooks/use-chat-stream.ts` is the React/i18n/browser-effects adapter over `src/application/turns/chat-stream-session.ts`, which owns single-flight admission, the active request and port, schema parsing, reducer transitions, reconnects, snapshots and cancellation. Keep translated errors, issue navigation and React state in the hook, and preserve the pure `chat-stream-reducer.ts` seam.
- `src/background/durable-turn-runtime.ts` is a ~82-LOC composition entry over `src/background/turns/`: `turn-observers.ts` (delivery state), `turn-generation.ts` (provider invocation, stream reduction, assistant persistence), `turn-reconnect.ts` (snapshot assembly), `turn-recovery.ts` (stop intent, interrupted cancellations, restart resumption), `turn-service-factory.ts` (adapter binding). `architecture-boundaries.test.ts` keeps the registry free of repository, provider, application and handler imports, and its maps in one file. Put a new control in the piece that owns it.
- `src/features/selection-actions/` reads view state from `selection-overlay-context.tsx`, not props. Only `SelectionOverlayApp` knows the reducer, the capture and the content script's refs; the overlay, panel, toolbar, header and footer take none. Add a control to the context value. `PanelMarkdown` and `PanelThinking` stay prop-driven leaves.
- `src/features/chat/components/chat-input/context-settings-menu.tsx` is the sheet shell and view switch (~205 LOC); settings in `hooks/use-context-settings.ts`, tab list and reconciliation in `hooks/use-context-tab-options.ts`, summary in `context-summary.ts`, views in `context-main-view.tsx` / `context-sub-view.tsx`. New context controls go in the hook and the main view.
- `src/features/sessions/stores/chat-session-store.ts` is a ~19-LOC barrel over slices; persistence reads via `chat-history.ts`.
- `src/features/model/components/provider-settings.tsx` delegates connection details and custom model editing to small components. Keep new slices scoped and covered by component tests.
- `src/contents/index.ts` is a ~38-LOC entry; selection-capture, dom-observer and messaging are siblings.
- `src/types/index.ts` is a ~11-LOC re-export barrel. Prefer the per-domain path (`@/types/chat`).
- `packages/contracts/src/chat.ts` is a ~31-LOC barrel over `chat-activity.ts`, `chat-attachments.ts`, `chat-replay.ts` and `chat-message.ts`. Consumers keep importing `@ollama-client/contracts/chat`; inside the package, import the part that owns the concept.
- Dexie chat-history paths are retired. Vectors and knowledge sets still use Dexie; chat history is SQLite-only through the facade.
