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

pnpm proxy                  # Run the olc proxy CLI from source
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
| `@ollama-client/olc` | standalone Node CLI: an OpenAI-compatible proxy for a local agent runtime ([details](#agent-runtimes-via-the-olc-proxy)) |

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

`packages/olc` is a Node CLI, not extension code. It serves a local agent runtime over `/v1/chat/completions`, so that runtime's models reach the extension through the ordinary OpenAI-compatible custom-provider flow.

- **Nothing in `src/` knows it exists.** Do not add proxy-aware branches to the extension: provider-shaped behaviour belongs behind the provider's own wire format, not behind a base-URL check in a handler.
- **An image is a part, not text.** An `image_url` content part carries no `text`, so flattening a message to a string drops it silently and leaves the model answering about pictures it never saw. `buildPromptParts` emits image parts as OpenCode file parts alongside the text, in message order.
- **Capabilities travel in the catalog.** `/v1/models` reports the runtime's own tool-calling, reasoning and modality flags as `capabilities`, `supported_parameters` and `input_modalities` — exactly what `openai-compatible.ts` already reads.
- **Tool calls round-trip through the wire format.** The runtime does not forward a caller's tool definitions to its model, so the proxy registers them, parks a call mid-turn, emits it as an OpenAI `tool_calls` delta with `finish_reason: "tool_calls"`, and resumes the same turn when the next request carries matching `tool_call_id`s. The extension's native tool loop drives it unchanged, and its approval and permission gates still apply because the tools still execute in the extension.
- Inside the proxy, `src/core/` is runtime-agnostic and every runtime detail sits behind the `AgentBackend` port (`src/backends/types.ts`), with OpenCode as the first adapter. A new runtime is an adapter plus a registry entry, never a change in `core/`.
- **A tool result belongs to one turn, or to none.** The parked-call registry is process-wide, so a follow-up releases only the calls the turn it resumes actually owns. A follow-up whose results name no live turn is refused with `400 StaleToolResults`; starting a fresh turn instead drops the result the client just produced and lets the model redo the work behind its back. The correlation is resolved twice — once to answer fast, once inside the queue slot — because a request can wait there for as long as another turn may run, and the parked turn's abandonment deadline is suspended for as long as its own resume is waiting.
- **One turn at a time is an invariant, not a hint.** A request past its deadline is cancelled through an `AbortSignal` and the queue keeps holding the slot: a task still running has not left the single-flight boundary, whatever its caller was told. If it will not stop, the queue refuses requests with `503` and names it rather than starting a second turn beside it.
- **A browser origin is refused unless it is allowed.** The proxy listens on loopback and runs an agent, so a wildcard `Access-Control-Allow-Origin` would let any page spend a turn — a missing response header does not stop a simple request. `ALLOWED_ORIGINS` defaults to the extension schemes; a request with no `Origin` is not a page and is left alone.
- `packages/olc/README.md` has the options, endpoints, build outputs and known limits.

### Browser sessions and capture

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
- `public/_locales/**/messages.json` and `public/assets/selection-locales/` are **generated** by `tools/generate-i18n-resources.ts`. Do not hand-edit them. `_locales` is committed because extension packages need it.
- Generation runs before `dev`/`build`/`package`, not on install, so run `pnpm generate:resources` manually after a locale edit to validate the catalogs.
- Before adding a key, check for an orphan that already fits — `tabs.select.ready` sat fully translated and unused.

### Testing

- Vitest with `happy-dom` and `fake-indexeddb`. `src/test/setup.ts` mocks chrome APIs and IndexedDB.
- Tests live in the nearest `__tests__` directory under `src/`, `packages/`, `config/` or `e2e/`. Never beside production modules.
- Single file: `pnpm test src/path/to/module.test.ts`.
- Coverage excludes only test files and `.d.ts`. UI components, type modules and barrels are included.
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

- `pre-commit`: lint-staged (typecheck, `format:fix`, `lint:fix`, `test:related`) → `format:check` → `lint:check` → `typecheck`. **Does not run the full suite.**
- `pre-push`: `pnpm test:run`.
- Never bypass with `--no-verify`. If a hook fails, fix the cause.

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
