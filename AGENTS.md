# AGENTS.md

Guidance for AI coding assistants (Claude Code, Cursor, Warp, Copilot, etc.) working in this repository.

Rules here are stated as rules. Where a rule exists because something broke, the reason is one clause, not a story — `git log` has the rest.

## Contents

- [Project overview](#project-overview)
- [Commands](#commands)
- [Architecture](#architecture) — entrypoints, chat round-trip, providers, RPC, storage, features
- [Subsystems](#subsystems) — RAG, web search, tools, browser sessions
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
pnpm typecheck              # tsc --noEmit

pnpm docs:dev               # Astro dev for the docs site (docs/)
pnpm docs:build             # Astro build → docs/dist/

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

Manifest — permissions, CSP, host permissions, `browser_specific_settings` — lives in **`wxt.config.ts` only**.

Dev-only entrypoints (`spike-*`, `benchmark`, `persistence-verify`) are stripped from store builds by `config/wxt-hooks.ts`, and their code is dead-code-eliminated via the `__SPIKE_OPFS_OWNER__` flags in `config/wxt-vite.ts`. `src/spike/` is therefore fine to leave where it is.

### Workspace packages

| Package | Owns |
|---|---|
| `@ollama-client/contracts` | environment-independent Zod schemas, RPC/stream envelopes, durable turn/context/tool-loop contracts |
| `@ollama-client/runtime-core` | deterministic stream reduction, thinking parsing, cancellation, retry, checkpoint, and sender-evidence primitives |
| `@ollama-client/chat-runtime` | port-driven durable turn, context-build, and tool-loop orchestration |

Packages never import React, WXT, browser APIs, persistence adapters, feature
UI, background composition, or concrete providers. Those remain in `src/` and
connect through package ports.

### Chat round-trip

1. UI opens a runtime port keyed by `MESSAGE_KEYS.PROVIDER.STREAM_RESPONSE`.
2. `src/background/index.ts` routes by message key to `src/background/handlers/`.
3. `ProviderFactory.getProviderForModel(modelId)` resolves the provider via `registry.ts` and the user's saved mapping.
4. The provider streams tokens back through the port; the background durable
   turn owner persists assistant state while `use-chat.ts` updates ephemeral UI
   state.

### Providers (`src/lib/providers/`)

| File | Role |
|---|---|
| `types.ts` | `LLMProvider`, `ProviderConfig`, `ProviderType`/`ProviderId` enums |
| `registry.ts` | static metadata for built-in providers |
| `factory.ts` | `ProviderFactory.getProviderForModel()` |
| `manager.ts` | stable provider CRUD/routing facade |
| `provider-config-repository.ts` | locked config recovery, hydration, defaults, and legacy URL adoption |
| `provider-mapping-repository.ts` | scoped model mapping migration and CRUD |
| `provider-compat-migration.ts` | removed-beta remapping, sanitization, and duplicate retention |
| `selected-model.ts` | active model state |
| `capabilities.ts` | capability detection and per-flag attribution |
| `model-lifecycle.ts` | shared lifecycle result normalization and safe provider errors |
| `ollama.ts`, `lm-studio.ts`, `llama-cpp.ts` | verified built-ins |
| `openai-compatible.ts` | custom OpenAI-compatible endpoints |
| `anthropic.ts` | native Claude Messages API |

Legacy vLLM/LocalAI/KoboldCPP subclasses are compatibility-only, not UI profiles. **Default fallback is Ollama** when no explicit model→provider mapping exists.

**Model discovery is not a requirement.** A provider's models are whatever `/models` returns *plus* the ids the user declared in `customModels`, and the merge happens whether or not discovery worked (`mergeProviderModels` in `provider-rpc-service.ts`). Hosted routers that implement only `/chat/completions` are normal, working providers — never gate a provider, a connection test, or the model menu on a catalog request succeeding.

A 404/405/501 from the catalog endpoint is recorded in `model-catalog-support.ts` (device-local, fingerprinted by wire + base URL + service profile, expiring after a day) and that provider is not asked again until the fingerprint changes, the entry ages out, or the user presses Test. Anything else — no answer, 401, 429, 5xx — is a real failure and is never recorded, because it says nothing about whether the endpoint exists. Adding a new discovery caller means going through `discoverModels`, not `provider.getModels` directly.

That policy lives in **`src/lib/providers/model-discovery.ts`** and is the only production path that asks for a catalog — RPC model listing, connection tests, background health checks, tool capability resolution and the embedding-model check all enter through it. `discoverProviderModels(provider)` is the shape for callers holding a live provider; the config it keys on comes off the provider, so there is no way to key an answer to the wrong endpoint. A failure is **returned as `catalog: "failed"`, not thrown**, because whether a missing catalog is fatal depends on the caller — normal for the model menu, disqualifying for a connection test. `architecture-boundaries.test.ts` fails on any `.getModels(` outside `model-discovery.ts` itself, with one exemption — `super.getModels`, a subclass delegating to its base wire format rather than a caller skipping the policy. The exemption is deliberately not directory-wide: a provider-domain service is exactly where the next bypass would appear.

The default provider's embedding check is the one remaining direct `/api/tags` fetch, and it stays direct on purpose — it skips provider resolution, and the remembered-absence policy is there to stop repeat requests against remote endpoints that charge for them, not against the user's own Ollama on loopback, whose catalog endpoint is not optional. Do not copy that shape for a configured remote provider.

**A missing catalog never proves reachability on its own** — a mistyped base URL answers identically. An explicit (`draft`) connection test confirms a catalog-less provider by streaming one token from `/chat/completions` with a declared model id; a chat route that is missing too is reported as a base-URL problem and clears the recorded answer. The background (`stored`) check never sends that request and never claims reachability it did not verify: it is a health poll, not a licence to spend inference on a metered endpoint.

**Vendor marks** are display-only. `provider-brand.ts` resolves a `ProviderBrandId` from a provider's configuration — built-in id, then base-URL host, then service profile, then display name — and `mergeProviderModels` stamps it onto every model row as `providerBrand`. Host beats profile: DeepSeek, Groq and the rest are all reached through an OpenAI-compatible profile, so a profile-first order would put OpenAI's mark on all of them. An unrecognized provider gets no brand and falls back to the registry glyph; never guess one, and never derive routing or capabilities from it. The marks themselves are inline monochrome SVG in `src/components/icons/provider-brand-icons.tsx` (from MIT-licensed `@lobehub/icons`) — rendered through `<ProviderIcon>`, not imported directly.

**Favicons are the tier below that**, for unrecognized *remote* providers only (`provider-favicon.ts`, served by `providers.icons`). The configured base URL is always asked first; its parent site is asked **only** when that host gave a settled "nothing here" (401/403/404/410, or a 200 carrying something that is not an image — an API gateway guards `/favicon.ico` behind its key exactly like every other path). A timeout or a 5xx is never chased, exactly one label is stripped (`api.acme.com` → `acme.com`, never down to a public suffix), and a third-party favicon service is never used, since that would hand every configured provider URL to whoever runs it. Loopback, private, CGNAT and link-local hosts are refused — `169.254.169.254` is the cloud metadata endpoint, and this fetch reaches what a page cannot — and **redirects are refused, not followed** — the host check vets the address we picked, while a 302 would let the provider pick the next one for a request holding `<all_urls>`. The response is sniffed from its leading bytes rather than trusted from `Content-Type`, capped at 32KB, and both hits and misses are remembered device-local so an endpoint is asked once; nothing is recorded once the caller has aborted.

The filter reads hostnames, so a public name resolving to a private address still passes, and no extension API closes that — `chrome.dns` is dev-channel only, and resolving before fetching is TOCTOU because `fetch` looks up again. What bounds it is that the response never leaves the device: no credentials are sent, non-image bytes are discarded, and it takes a provider the user already trusts with their prompts. Do not "fix" it by adding a resolve step; the honest mitigation is the off switch. Users can turn the lookup off; doing so also drops what was already fetched.

**Capability detection** resolves in this order, highest first: user override → empirical probe (`capability-probe.ts`) → model metadata → provider default. An unknown capability resolves to `false`; only an override may flip it on. Never enable vision or tool calling on a guess.

**Model lifecycle wires stay in provider adapters.** `LLMProvider.modelLifecycle` is an optional port for loaded-model listing, unload, and warmup. `ModelRpcService` owns RPC policy and warmup cooldowns, but never constructs vendor lifecycle URLs or branches on provider ids. A capability flag and its optional operation must agree; providers without an operation return an unsupported/no-op result rather than receiving an Ollama-shaped request.

Metadata evidence, strongest first:

- Ollama `/api/show` `capabilities[]` tags → high confidence
- LM Studio `capabilities[]` (e.g. `["tool_use"]`) → high, for the flags it names
- OpenRouter-style `modalities` / `supported_parameters` → high
- LM Studio `type` (`llm`/`vlm`/`embeddings`) → medium; a category, not a statement about the model
- provider default → low

An **empty** metadata array means "unknown", never a reported no — empty catalog arrays are placeholders often enough that treating them as negatives silently disables working models. When you add a metadata source, update both `getModelCapabilities` and `getModelCapabilityStates`; the second drives the capability sheet's "where did this come from" attribution and must not contradict the first.

Model list metadata differs sharply by server, so check before assuming a field exists:

- **Ollama** `/api/tags` omits `family`, `parameter_size`, and `quantization_level` for non-GGUF (safetensors/MLX) models. `getModels` backfills those from `/api/show`, only for models whose format is reported, non-GGUF, and sizeless. Capped fan-out; a failed lookup leaves the model as-is.
- **LM Studio** reports no size of any kind on any endpoint. `parameterSizeFromModelId` reads it from the id by convention and refuses when the id is ambiguous. Never put `max_context_length` in `parameter_size` — that shipped once and rendered a token window as a model size.
- **llama.cpp** reports `meta.n_params` and already formats to one decimal.

`formatParameterSize` normalizes whatever arrives so one list cannot mix `8B`, `8.2B`, and `999.89M`.

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

- Register it in `RpcMethod`, `RpcMap`, and `RPC_METHOD_DEFINITIONS`; refer to it through the enum, never a duplicated wire string.
- Validate both ends. Keep credentials out of results and diagnostics. Return i18n message keys plus safe fallback text.
- `allowedSources` is `["extension-page"]` for every method, and a contract test asserts it. Content scripts never reach the protocol, because page-controlled data influences their messages — widening this is a security decision, not a registry edit.
- Queries must have no persistence side effects, so a client timeout cannot commit stale state. Persist derived state only after the caller accepts the result.
- Client timeouts send `app-rpc-cancel`; the server aborts the matching request and passes the `AbortSignal` into provider fetches. Preserve that path for anything long-running.
- Widening `capabilityHints` means editing the schema *and* its transform in `provider-rpc.ts` — the transform whitelists fields, so a schema-only change silently drops the value.

### Storage

Chat history is **SQLite-only**, on one engine and one writer: official sqlite-wasm, in a worker owned by the persistence host. sql.js is gone from the package as of 0.13.x — it is a devDependency now, used only by the measurement pages to *write* old-topology fixtures. The Dexie chat-history fallback is retired; Dexie remains for vector embeddings and knowledge sets.

**No context outside the owner holds a database handle.** `src/lib/sqlite/db.ts` is an RPC client, `getDb()` no longer exists, and adding a second engine or a second writer is the change to argue for in review rather than make.

| Data | Where |
|---|---|
| Chats, sessions, messages, files | `src/lib/repositories/chat-history.ts` — a facade over `sqlite-chat-history.ts`. Go through the facade. |
| SQLite internals | `src/lib/sqlite/` (`db.ts` RPC facade, `schema.ts`, `migrations/`) |
| The engine itself | `src/lib/persistence/chat-db-engine.ts`, wrapped by `chat-db-worker.ts` |
| On-install embedding-dimension migration | `src/lib/migration/`, invoked from `src/background/index.ts` |
| Vectors / embeddings | `src/lib/embeddings/` — still IndexedDB via `storage.ts`, not migrated to SQLite |
| Settings, config, per-extension state | `@plasmohq/storage` via `src/lib/plasmo-global-storage.ts` |

- **Session metadata** — pinned state, per-chat system prompts, user tags — lives on SQLite `sessions`. Add columns through forward-only migrations.
- **Message-subtree deletion is atomic in SQLite.** `deleteMessageSubtree` discovers descendants, repairs `sessions.currentLeafId`, and deletes message/file rows inside one transaction. Dexie vectors cannot join that commit; callers clean them up afterward by the returned message ids, and that cleanup must stay idempotent.
- **Durability depends on the backend.** On **opfs** — every profile that has migrated — a committed statement is already durable and `flushSave()` is a no-op. On the **legacy blob**, the owner debounces a full-image write to IndexedDB by 1s, and `flushSave()` forces it. Callers flush at unload, migration and export boundaries without knowing which answered.
- **A damaged legacy image is served read-only.** A blob that fails `integrity_check` keeps its reads, its backup export and its diagnostics; writes throw, migrations do not run against it, and it is never written back. Do not "fix" that by letting writes through — the image is the rollback artifact.
- **Turn lifecycle is a state machine, enforced in SQL.** `TURN_STATUS_PREDECESSORS` in `packages/contracts/src/turns.ts` is the whole truth; every status write is a compare-and-set against the target's allowed predecessors, so a late or duplicated message cannot move a settled row and a terminal row never regresses. `updateTurnRun` resolves false when a transition is refused, and `TurnRuntime` treats that as "someone else owns this turn" and does no provider work. A stop commits `cancelling` **before** aborting the controller — a worker lost between the two restarts into an intent recovery skips, where a row left at `generating` was handed straight back to the provider. Startup finalizes interrupted cancellations without reissuing anything, and a turn row that will not parse is terminally failed with a content-free diagnostic rather than silently skipped on every boot forever.
- **A settled turn keeps no resumable input.** A live `turn_runs.request` holds everything a restart needs — the whole prior conversation, extracted file text, captured page bodies, base64 images — which is correct while the turn can be resumed and indefensible once it cannot: n turns would each leave a permanent copy of the conversation as it stood, so a chat costs O(n²) bytes and page text outlives the feature that captured it. The request is therefore replaced by `compactedTurnRequest(...)` **in the same statement that writes the terminal status**, never in a later pass — nothing updates a settled row again, so a second write is one a dying worker can skip forever. That covers `updateTurnRun`, `finalizeCancelledTurn` and `quarantineTurnRun`; migration 14 clears the backlog. What remains as evidence is the bounded `contextReceipt`, the canonical message rows the receipt points at, and the recorded failure. `getTurnRun` returns a `TurnLifecycleRecord` with no request at all, because a reader that demanded one would report every settled turn as missing; only `getIncompleteTurnRuns` parses the full shape, and a resumable row that is somehow already compacted is quarantined like any other unreadable one. `pruneTerminalTurnRuns` then bounds how many receipts accumulate, by status and never by age alone — a browser closed for six weeks still owes the user its interrupted turns. The `turn_retention` diagnostic reports counts and byte lengths only; a non-zero `uncompactedTerminalRuns` is the one condition nothing self-corrects.
- **A failure generation produced is recorded as it stands.** `DurableTurnGenerationError` carries the structured `AppFailure` from the terminal stream event through the turn row, the assistant row, the reconnect snapshot and the bubble. Rebuilding an `Error` from its text is what turned a provider 500 into a bare "Turn failed before completion."
- **Tool-loop durability** — active native and non-native tool loops checkpoint to `tool_loop_runs` at model/tool/approval boundaries and force-flush before awaiting approval. The sidepanel reconnects with the same request id after an MV3 worker restart. Do not remove that checkpoint/reconnect contract.
- **Reasoning replay** — signed Anthropic thinking/redacted blocks and OpenRouter `reasoning_details` live in the versioned, size-capped `ChatMessage.replayArtifact`, separate from display-only `thinking`. Preserve block order and opaque values through SQLite and checkpoints, validate provider/model ownership before replay, and never render or log opaque contents.
- **Sync vs local** — sync-safe settings use `chrome.storage.sync`; device-local keys are routed to `chrome.storage.local` by the wrapper.

#### State ownership

Four state systems hold live values. Each value has exactly one owner; the rest read it. Picking the wrong owner is how a value ends up written from two places with no rule for which wins.

| System | Owns | Never holds |
|---|---|---|
| **SQLite** (`chat-history.ts` facade) | chats, sessions, messages, attachments, prompt templates, tool-loop checkpoints, durable job runs | anything a UI needs synchronously on first paint |
| **Dexie / IndexedDB** (`lib/embeddings/`, `lib/knowledge/`) | vectors, HNSW and keyword indexes, knowledge sets, chunk feedback | anything SQLite already owns — chat rows never live in both |
| **`chrome.storage`** via `plasmoGlobalStorage` | settings, provider config and mappings, capability overrides, approval grants, handoff flags, persistence markers and the migration receipt | bulk data, and anything large enough to matter against the sync quota |
| **Zustand stores** | ephemeral UI state: selected tabs, input draft, stream progress, speech, search dialog | durable values, unless the store explicitly reads and writes through one of the systems above |

Rules that follow from it:

- **Every `chrome.storage` key needs a descriptor** in `src/lib/storage/storage-key-registry.ts` with its sync scope and a `reason`. `storage-key-registry.test.ts` asserts the registry and `STORAGE_KEYS` match exactly, so adding a key without one fails.
- **Two stores are durable-backed and say so:** `stores/theme.ts` and `stores/shortcut-store.ts` read and write `plasmoGlobalStorage`. Every other store is ephemeral and its contents die with the page — do not add a durable value to one of them.
- **`MESSAGE_KEYS` are not storage keys.** They name runtime ports and one-way events, hold nothing, and do not belong in the storage registry.
- The background/application layer owns durable workflows; the UI submits intent. A durable value written directly from a component is a boundary violation even when it works.

The persistence host (Chromium offscreen document / Firefox MV2 background page) owns the only chat-db worker. It reports worker `error` and `messageerror` events with their cause — keep it that way; a bare "worker crashed" hides the actual failure. Note that in dev the worker loads from the Vite dev server, which is why `worker-src` allows that origin during `serve` only (`config/__tests__/manifest-csp.test.ts` guards both halves).

The host also decides which backend the owner serves, once per session, from the marker and the migration outcome — `setBackend` is host-only and the RPC listener rejects it from any sender. A migration that fails verification **resolves onto the legacy backend**; it does not reject. Only the owner failing to start rejects. That distinction is the whole reason `ensureMigrated` can be awaited before every request.

**An owner is ready when it answers, not when it exists.** `chrome.offscreen.createDocument()` resolves before the host page has evaluated its script, so a document can exist with no listener, no worker, no WASM and no chosen backend. `ensurePersistenceOwnerReady()` proves the whole chain with one `ping` and caches the proof per owner instance — never the failure, so a later caller retries. The ping carries its own 30s cap, because a host that accepts the message and never answers would otherwise hold readiness open forever; the retry deadline only bounds attempts that fail. The background composition root starts the topology and hands that one promise to `initializeBackgroundStartup`; DB-touching startup work awaits it and is skipped for the boot when it rejects, rather than each task waiting out its own 30s client timeout. Startup order is lifecycle flags → owner → data-shape recovery (backup import, provider migration, embedding-dimension migration; sequential, because they rewrite what follows reads) → durable workflow recovery (bounded concurrency). Every task receives an `AbortSignal`; its deadline requests cancellation, and its worker does not start a successor until the task settles and thereby acknowledges that no more mutations remain in flight. A supervisor abort leaves durable user work resumable rather than recording a user cancellation. Adding a DB-touching startup task means adding it to one of those lists, threading the signal through every mutation boundary, and proving deferred cancellation cannot overlap its successor — not `void`-ing it beside them.

Retrying a persistence write needs evidence, not optimism. `RETRYABLE_OPS` names the ops that are idempotent by construction; anything else is retried only when the client throws `PersistenceNotDeliveredError`, which is raised before a byte is sent and therefore proves non-execution. Do not widen either rule to make a flaky boot look better.

Persistence failures are typed (`src/lib/persistence/errors.ts`). `PersistenceError` carries the `op`, a `reason` (`not-delivered` / `timeout` / `owner-error` / `invalid-response`), a `retryable` getter applying the rule above, and safe `userMessage` text. **The owner's own message never becomes the error text** — it forwards SQLite verbatim, which names tables, columns and statement fragments, so it travels as `detail` for diagnostics while `message` stays a safe summary. `detail` and `cause` are also declared under `PRIVATE_ERROR_KEYS` (`src/lib/log-redaction.ts`) and defined non-enumerable: structured logging copies an error's own enumerable properties **and** follows `cause` by name, so keeping the text out of `message` alone left two back doors into the console and the diagnostics bundle. Redaction is otherwise keyed on property names, which cannot work for a value whose sensitivity comes from where it was obtained rather than what it is called — that is what the symbol is for, and it is opt-in, so no other error loses diagnostics. That holds on **both** paths: the in-process fast path reaches the worker directly and used to reject with its raw Error, which mattered most on Firefox MV2, where the background page is owner and heaviest client at once. The client cannot tell the two in-process stages apart, so the **owner** labels them: `registerPersistenceHost` wraps startup failure in `PersistenceNotDeliveredError` — nothing has been posted to the worker at that point, and `ensureMigrated` clears its memo on failure so the retry really re-attempts — while anything from `callWorker` onward stays `owner-error`, including a worker that dies mid-statement, where the write may well have committed. Everything the client wraps on its own takes `owner-error`, because claiming non-execution it cannot prove is what turns a lost write into a duplicated one. Bound parameters, where chat and page content live, are not echoed by SQLite today, but that is not a property to build a disclosure boundary on.

**Durable rows are decoded, not asserted.** `query` resolves a bag of `SqlValue`s, and `as unknown as Row[]` is an unconditionally-true, unconditionally-unchecked claim about it — a column dropped by a half-applied migration or a status written by a newer build arrives as a well-typed object that is wrong. It was never load-bearing either: a query result flows into a decoder with no cast at all, and `architecture-boundaries.test.ts` fails on a row-collection assertion (`as unknown as X[]`, `[X]`, `Array<X>`) in **any** module importing `@/lib/sqlite/db`. Scoped by what a module does rather than where it lives, because a directory rule covered the repositories and missed `lib/embeddings/feedback-service.ts`, which read `chunk_feedback` with the identical assertion. Object- and function-typed shims for under-typed browser APIs are a different thing and stay allowed. Every durable job repository declares a Zod row schema and goes through `decodeRow`/`decodeRows` in `row-decoder.ts`, which logs the failing paths and codes (never Zod's messages — an enum mismatch embeds the stored value) plus the row id, and nothing else from the row. The decode context's `table` is the shared `DurableTable` union from `persistence/durable-tables.ts`, so table names have one spelling and a typo is a typecheck failure. The failure policy is per-repository and deliberate: `turn_runs` quarantines, falling back to an id-only read so an undecodable row can still be settled rather than re-rejected on every boot; `tool_loop_runs` raises, because its caller is mid-resume; ingestion and model-pull drop and log, because one bad row must not deny recovery to the rest of the list. `durable-row-contract.smoke.test.ts` drives the real engine to prove each writer and its schema still agree.

Keep the engine reachable without a Worker. `chat-db-engine.ts` is split from `chat-db-worker.ts` so tests can drive it in-process — there is no Worker and no OPFS in vitest, so an engine only reachable through `postMessage` would be testable only through a browser harness. The legacy backend runs fully in vitest (`legacy-blob-backend.test.ts`); OPFS is covered by `pnpm verify:opfs-migration`.

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

- Pipeline: `src/application/context/rag/` (`rag-pipeline.ts`, `rag-retriever.ts`, `rag-prompt-builder.ts`, `query-classifier.ts`), driven by `src/application/context/build-context.ts`. It moved out of `src/features/chat/` when context building went to the background — a feature directory cannot own work the background performs.
- **All** file, memory, and live-page splitting goes through `src/lib/embeddings/chunker.ts`. Do not build a parallel text splitter.
- Plumbing: `src/lib/embeddings/` (`embedding-strategy.ts`, `embedder-factory.ts`, `hnsw-index.ts`, `keyword-index.ts`, `storage.ts`, `chunker.ts`, `search.ts`).
- Embedding strategy chain: provider-native → shared model → Ollama fallback.
- Hybrid search: keyword (`minisearch`) + dense (`hnsw`), configurable weights.
- Reranking is a **cosine-similarity re-scorer** (`reranker.ts`), on by default — **not** a cross-encoder. A transformers.js / ONNX Runtime cross-encoder was blocked by MV3 CSP and never shipped; neither library is a dependency. `config.ts` accepts the legacy `transformers-js`/`onnxruntime-web` strings only as a shim collapsing them to `cosine`.

There is no `src/lib/rag/core/` tree. Any doc referencing one is stale.

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

### Browser sessions and capture

- Read-only helpers: `src/lib/browser-sessions.ts`. Model tools: `src/lib/tools/internal/browser-session-tools.ts`.
- `sessions` is an optional permission. Always check browser support **and** the live permission before reading recently-closed or synced-device sessions.
- Session URLs must pass the same unreadable/never-read filters as other browser tools.
- Do not expose `sessions.restore()` to a model until tool execution has a real interactive approval boundary.
- `tabCapture` + `offscreen` is a Chromium 116+ prototype. Any capture flow must start from a user gesture, preserve tab audio, show persistent recording state and a Stop control, stop on permission revoke, and keep data ephemeral until explicitly saved.

## Conventions

### Messaging keys

**Do not add a request/response runtime message — add an `RpcMethod`.** Since `0.12.5` every provider, model, and embedding round trip goes through `src/protocol/`. `MESSAGE_KEYS` keeps only streaming port names, one-way events, and `PROVIDER.GET_MODELS` (the single content-script-reachable read, outside the protocol because the RPC envelope is extension-page-only by policy).

`MESSAGE_KEYS.OLLAMA.*` is two port names (`STREAM_RESPONSE`, `PULL_MODEL`). Do not add to `LEGACY_OLLAMA_MESSAGE_KEYS` — the legacy request/response twins were deleted because a page old enough to send one already has an invalidated extension context.

`STORAGE_KEYS.PROVIDER.*` vs `LEGACY_STORAGE_KEYS.OLLAMA.*` is a different case: storage keys name persisted data, so those legacy strings are real.

### Background handlers

`src/background/handlers/handle-{action}.ts`, registered in `src/background/index.ts`. Only streaming/port work belongs here (chat, context build, pull, selection actions, embedding download). Request/response provider and model operations live in `ProviderRpcService` / `ModelRpcService`. Keep handlers thin — adapt the port protocol to `src/lib/` and stream back.

A handler that only *writes* a stream takes `ChatStreamSink`, not `ChromePort`. The sink is `name` + `postMessage` + the optional `abortScopeKey`/`streamSequence`, which is the whole surface a producer uses; a real port satisfies it structurally, so nothing at the port boundary changes. It exists because the durable turn runtime consumes the same stream in-process — it reduces events into durable state rather than shipping them to a panel — and used to reach `handleChatWithModel` by casting a three-property object to `ChromePort`, asserting an `onMessage`, `onDisconnect`, `sender` and `disconnect()` that did not exist. `withErrorContext` is generic over the port type and still defaults to `ChromePort`, so handlers that genuinely need a connection keep it. The one remaining `as unknown as ChromePort` is in `port-router.ts`, adapting a real `browser.Runtime.Port`, and a boundary test keeps it the only one.

### Component layers

Four tiers, and the tier decides the rules:

1. `src/components/ui/` — vendored shadcn primitives, curated. Check whether an existing primitive or a small composition works before adding one.
2. `src/components/{settings,actions,feedback,forms,layout}/` — app-owned composites.
3. `src/features/<x>/components/` — feature UI.
4. `src/sidepanel/`, `src/options/` — shells.

**A component with no importer outside its own layer is speculative.** Add the second real caller in the same change, or don't add the component.

**The options-page composites do not fit the side panel.** `SettingsRow` is `p-3 text-sm` with breakpoints, built for ~900px; the side panel is ~400px and dense. Reach for a dense primitive rather than hand-rolling a smaller copy of a page-sized one.

### Component name suffixes

The suffix names what a component *renders*, not how important it feels.

| Suffix | Renders |
|---|---|
| `*-card.tsx` | its own bordered surface as the root (`Card`, `SettingsCard`) |
| `*-section.tsx` | a titled group with no surface of its own |
| `*-fields.tsx` | a bare group of form fields — fragment root, no title, no surface |
| `*-panel.tsx` | a feature's whole composed surface, arranging its own cards and sections |

Match the suffix to the root element when adding or restructuring.

### Dense list rows

Side-panel rows shaped *leading glyph → label → trailing action* go through `ListRow` / `ListRowButton` (`src/components/layout/list-row.tsx`). Do not rebuild the grid — hand-rolled copies are why one sheet had leading edges on 8/16/18/26px.

- `ListRow` is a `div`, for rows whose title and trailing control are separate hit areas.
- `ListRowButton` is the same geometry on a `<button>`, for whole-row targets.
- `inset="nested"` inside an already-padded scroll container.
- `trailingKind="control"` when the trailing slot ends in a hit-area that pays its own padding.
- `description` for a second line of the row's own label; `below` for a second line owning its own content.

`EmptyState` needs `density="compact"` in a dense list.

### Icons

Import from `lucide-react` directly. There is no re-export barrel — `@/lib/lucide-icon` was retired because tree-shaking already drops unused icons through a re-export (bundle size was identical without it) and nothing enforced it as an allowlist.

`LucideIcon` is a type export of `lucide-react`. There is no `CheckIcon` — use `Check as CheckIcon`.

`src/components/__tests__/design-system-contract.test.ts` requires named size tokens (`icon-sm`, `icon-xs`, …) on Lucide components, not raw `size-4` classes, and bans `text-[…]` and `rounded-md`/`rounded-lg` repo-wide.

### React Hook Form fields

Use the `Controlled*` wrappers in `src/components/forms/`. **Never spread `register(...)` into a `src/components/ui/*` primitive** — several are controlled Base UI wrappers, and spread-register can leave the DOM looking updated while RHF still holds the old value. `src/components/forms/__tests__/react-hook-form-contract.test.ts` enforces this for production TSX and does not enumerate wrapper names.

The set is `ControlledTextarea`, `ControlledNumberInput`, `ControlledSlider` — what the one RHF form in the app (`model-settings-form.tsx`) binds. Others were deleted for having no caller; recover them from git when a form needs one.

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
- Generation runs automatically before `dev`/`build`/`package`. It no longer runs on install — `prepare` only installs husky — so run `pnpm generate:resources` manually after any locale edit to validate the catalogs.
- Before adding a key, check for an orphan that already fits — `tabs.select.ready` sat fully translated and unused.

### Testing

- Vitest with `happy-dom` and `fake-indexeddb`. `src/test/setup.ts` mocks chrome APIs and IndexedDB.
- Tests live in the nearest `__tests__` directory under `src/`, `packages/`,
  `config/`, or `e2e/`. Do not place `*.test.*` or `*.spec.*` beside production
  modules.
- Single file: `pnpm test src/path/to/module.test.ts`.
- Coverage excludes only test files and `.d.ts`. UI components, type modules, and barrels are included.
- `@testing-library/user-event` is **not** a dependency — use `fireEvent`.
- When a change breaks an existing test, work out whether the test or the change is wrong. A broken assertion is sometimes the design telling you something: a fan-out that consumed a queued fetch response failed the Ollama contract test, and the predicate was the bug.

Contract tests worth knowing about, because they enforce conventions no reviewer would catch:

| Test | Enforces |
|---|---|
| `components/__tests__/design-system-contract.test.ts` | icon size tokens, typography/radius tokens |
| `components/forms/__tests__/react-hook-form-contract.test.ts` | no spread-`register` |
| `lib/providers/__tests__/contract.test.ts` | provider list/stream parsing |
| `config/__tests__/manifest-csp.test.ts` | no dev origin in a packaged CSP |
| `config/__tests__/test-layout.test.ts` | every test/spec stays in a `__tests__` directory |
| `config/__tests__/documentation-comments.test.ts` | module/declaration prose uses JSDoc instead of `//` blocks |
| `lib/__tests__/browser-api-contract.test.ts` | guarded browser API access |
| `lib/__tests__/architecture-boundaries.test.ts` | chat-history goes through the facade; SQLite internals stay out of UI; one SQLite engine ships |
| `config/__tests__/wxt-build-config.test.ts` | which dev pages and WASM assets a store build carries |

### Lint and formatting

Biome, not ESLint/Prettier: 2-space indent, LF, double quotes, no semicolons (except ASI hazards), no trailing commas, bracket-same-line JSX.

`__tests__/` may use `noExplicitAny`. Vendored shadcn a11y suppressions are per-line comments in the offending file — there is no blanket override for `src/components/ui/**`.

Biome also rewrites some Tailwind arbitrary values to canonical form (`row-end-[-1]` → `-row-end-1`) and enforces exhaustive hook dependencies, so a `deps.join()` trick will fail — memoize instead.

### Git hooks (`.husky`)

Branch promotion has three stages: `release/*` → `preview` → `main`. Merge a
release branch into `preview`, validate it there, then merge `preview` into
`main`. Do not promote a release branch directly to `main`.

- `pre-commit`: lint-staged (typecheck, `format:fix`, `lint:fix`, `test:related`) → `format:check` → `lint:check` → `typecheck`. **Does not run the full suite.**
- `pre-push`: `pnpm test:run`.

Never bypass with `--no-verify`. If a hook fails, fix the cause.

## Constraints

- MV3 CSP blocks dynamic eval; WASM is allowed via `'wasm-unsafe-eval'`. ONNX Runtime is bundled, never fetched.
- Firefox lacks Chrome's `declarativeNetRequest` semantics. Cross-origin provider requests rely on `host_permissions: ["<all_urls>"]` plus CORS-friendly endpoints.
- Provider model-name collisions make routing ambiguous. `ProviderFactory` resolves via the saved mapping first, Ollama fallback last.
- Token budgeting in `lib/embeddings/chunker.ts` is approximate (`chars / 4`).
- A dev build emits no chunks to disk beyond the reload shim; everything is served from the Vite dev server. `chrome.runtime.getURL` is not available for dev-only asset paths.

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

## Current state of known hotspots

What these files are *now*, so you neither go looking for a god-object that was already split nor assume a large file is fine.

**Do not restructure incrementally:**

- `src/features/chat/hooks/use-chat-stream.ts` — owns port lifecycle, reconnect,
  stop/finalization, stream presentation, and error UI. Its staged extraction is
  tracked in `RELEASE_ROADMAP.md`; keep edits minimal and preserve the pure
  `chat-stream-reducer.ts` seam.

- `src/features/chat/hooks/use-chat-turn-controller.ts` — owns UI submission
  preconditions, session/message preparation, and durable turn command
  construction. Its boundary cleanup is tracked in `RELEASE_ROADMAP.md`. Keep
  `use-chat.ts` as wiring only.

**Open for incremental work:**

- `src/features/file-upload/hooks/use-file-upload.ts` — still owns UI state around ingestion; pipeline helpers are in `file-upload-pipeline.ts`. Keep moving validation, registration, and embedding enqueue out of the hook.

**Already restructured — match the existing shape rather than reverting to props or god-objects:**

- `src/features/selection-actions/` reads view state from `selection-overlay-context.tsx`, not props. `SelectionOverlayApp` alone knows about the reducer, the capture, and the content script's refs; `SelectionActionsOverlay`, `SelectionPanel`, `SelectionToolbar`, `PanelHeader`, `PanelFooter` take no props. Add a control to the context value and read it where it renders. `PanelMarkdown` and `PanelThinking` stay prop-driven — leaf presentational, own tests.
- `src/features/chat/components/chat-input/context-settings-menu.tsx` is the sheet shell and view switch (~205 LOC). Settings in `hooks/use-context-settings.ts`, tab list and its reconciliation effects in `hooks/use-context-tab-options.ts`, summary in `context-summary.ts`, views in `context-main-view.tsx` / `context-sub-view.tsx`. New context controls go in the hook and the main view, not the shell.
- `src/features/sessions/stores/chat-session-store.ts` is a ~19-LOC barrel over extracted slices; persistence reads via `chat-history.ts`. The old ~485-LOC store is gone.
- `src/features/model/components/provider-settings.tsx` delegates connection details and custom model editing to small components. Keep new slices similarly scoped and covered by component tests.
- `src/contents/index.ts` is a ~38-LOC entry; selection-capture, dom-observer, and messaging are siblings.
- `src/background/durable-turn-runtime.ts` is a ~82-LOC composition entry — `startDurableTurn`, the live-only context callbacks, and re-exports that keep its import path stable. The pieces live in `src/background/turns/`: `turn-observers.ts` (delivery state — attach, buffer, forward, snapshots, reconnect leases, and nothing else), `turn-generation.ts` (provider invocation, stream reduction, assistant persistence), `turn-reconnect.ts` (snapshot assembly for a returning panel), `turn-recovery.ts` (stop intent, interrupted cancellations, restart resumption), `turn-service-factory.ts` (adapter binding, split out so recovery can build a service without importing the entry that re-exports it). `architecture-boundaries.test.ts` enforces the split: the registry imports no repository, provider, application or handler module, and its maps exist in exactly one file. Put a new control in the piece that owns it, not back in the entry.
- `src/types/index.ts` is a re-export barrel (~11 LOC) over `chat`, `model`, `messaging`, `errors`, `content-extraction`, `ui-state`. Prefer the per-domain path (`@/types/chat`).
- `packages/contracts/src/chat.ts` is a ~31-LOC barrel over `chat-activity.ts` (retrieval sources, tool runs, activity events, metrics), `chat-attachments.ts`, `chat-replay.ts` and `chat-message.ts`. The `./chat` subpath export and the exported names are unchanged, so every consumer still imports from `@ollama-client/contracts/chat`; inside the package, import the part. Add a new schema to the part that owns the concept, and export it from the barrel only if it is public.
- Dexie chat-history paths are retired. Vectors and knowledge sets still use Dexie; chat history is SQLite-only through the facade.
