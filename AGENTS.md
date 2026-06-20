# AGENTS.md

Guidance for AI coding assistants (Claude Code, Cursor, Warp, Copilot, etc.) working in this repository.

## Project Overview

Browser extension (Chrome MV3 / Firefox MV2) for chatting with local and remote LLM providers, with local-first RAG over uploaded files and optional provider-backed web search. Built with WXT, React 19, TypeScript 5.9, Tailwind v4, and Biome.

Supported user-facing providers (all live, all in `src/lib/providers/`): **Ollama, LM Studio, llama.cpp, vLLM, KoboldCPP, LocalAI**. `openai-compatible.ts` is the shared OpenAI-compatible base implementation, not a separate configured provider.

## Development Commands

```bash
pnpm install                # Install dependencies
pnpm dev                    # Dev build, Chrome MV3
pnpm dev:firefox            # Dev build, Firefox MV2
pnpm build                  # Production build, Chrome MV3
pnpm build:firefox          # Production build, Firefox MV2
pnpm package                # Zip Chrome build for upload
pnpm package:firefox        # Zip Firefox build for upload

pnpm test                   # Vitest, watch mode
pnpm test:run               # Vitest, one-shot (use this in CI/pre-commit)
pnpm test:related           # Only tests affected by working-tree changes
pnpm test:coverage          # Coverage report

pnpm lint:check             # Biome check (no writes)
pnpm lint:fix               # Biome check --write
pnpm format:check           # Biome format check
pnpm format:fix             # Biome format --write
pnpm typecheck              # tsc --noEmit

pnpm docs:dev               # Astro dev for the marketing/docs site (docs/)
pnpm docs:build             # Astro build → docs/dist/ (Vercel output)

pnpm generate:resources     # Regenerate src/i18n/resources.ts from src/locales/
```

Run `pnpm typecheck && pnpm lint:check && pnpm test:run` before opening a PR. If you changed anything under `docs/` or `src/locales/`, also run `pnpm docs:build && pnpm generate:resources` to verify docs build and i18n regeneration succeed.

## Architecture

### Entry Points (WXT)

WXT discovers entrypoints from `src/entrypoints/`. Each entrypoint is a thin bootstrapper that mounts a feature shell from elsewhere in `src/`:

| Entrypoint | File | Mounts |
|---|---|---|
| Side panel | `src/entrypoints/sidepanel/index.tsx` | `src/sidepanel/index.tsx` (main chat UI) |
| Options page | `src/entrypoints/options/index.tsx` | `src/options/index.tsx` (settings/configuration) |
| Background service worker | `src/entrypoints/background.ts` | `src/background/index.ts` (message dispatcher) |
| Content script | `src/entrypoints/content.ts` | `src/contents/index.ts` (selection capture, page extraction) |
| Selection-button overlay | `src/entrypoints/selection-button.content.tsx` | (self-contained content UI) |
| Print page | `src/entrypoints/print/` | Standalone print-friendly export |

Manifest (permissions, CSP, host permissions, `browser_specific_settings`) lives in **`wxt.config.ts` only**. It is no longer duplicated in `package.json`.

### Data Flow (chat round-trip)

1. UI opens a runtime port and sends a request keyed by `MESSAGE_KEYS.PROVIDER.STREAM_RESPONSE`.
2. Background (`src/background/index.ts`) routes by message key to a handler in `src/background/handlers/`.
3. `ProviderFactory.getProviderForModel(modelId)` (`src/lib/providers/factory.ts`) resolves the right provider via `src/lib/providers/registry.ts` and the user's saved mapping.
4. Provider streams tokens back through the port; UI updates state via `use-chat` (`src/features/chat/hooks/use-chat.ts`) and persists to storage.

### Provider System (`src/lib/providers/`)

- `types.ts` — `LLMProvider` interface, `ProviderConfig`, `ProviderType`, `ProviderId` enums
- `registry.ts` — static registry of all available providers
- `factory.ts` — `ProviderFactory.getProviderForModel()` and friends
- `manager.ts` — `ProviderManager` for config + model mappings via `ProviderStorageKey`
- `selected-model.ts` — currently-active model state
- Individual provider implementations: `ollama.ts`, `lm-studio.ts`, `llama-cpp.ts`, `vllm.ts`, `koboldcpp.ts`, `localai.ts`; `openai-compatible.ts` provides the shared OpenAI-compatible base class. OpenAI-compatible subclasses are picked from a small `OPENAI_COMPAT_CONSTRUCTORS` map inside `factory.ts`; anything not in that map falls back to plain `OpenAICompatibleProvider`.

**Default fallback** is Ollama when no explicit model→provider mapping exists.

### Storage

Chat-history storage now runs on sql.js (SQLite-in-WASM). The Dexie chat-history fallback has been retired; Dexie remains only for vector embeddings and knowledge-set storage.

- **Chat / sessions / messages / files**: routed through `src/lib/repositories/chat-history.ts` — a SQLite-only facade over `src/lib/repositories/sqlite-chat-history.ts`. New code should keep using the facade rather than importing SQLite internals directly.
- **SQLite**: `src/lib/sqlite/` (`db.ts`, `schema.ts`, `migrations/`). The on-install `runEmbeddingDimensionMigration` lives under `src/lib/migration/` and is invoked from `src/background/index.ts`. There is no `src/background/migrations/` directory anymore.
- **SQLite durability contract**: writes are debounced 1s to IndexedDB. Page-unload and explicit reset/export paths force-flush via `flushSave()` where needed.
- **Vectors / embeddings**: `src/lib/embeddings/` (HNSW + keyword index). Vector storage still lives in IndexedDB via `lib/embeddings/storage.ts`. The vector store has not been migrated to SQLite yet.
- **Settings / config / per-extension state**: `@plasmohq/storage` accessed through `src/lib/plasmo-global-storage.ts`. Sync-safe settings use `chrome.storage.sync`; device-local keys are routed to `chrome.storage.local` by the wrapper.

When picking a storage layer for new chat-history work, go through `src/lib/repositories/chat-history.ts` rather than touching SQLite directly.

### Key Constants (`src/lib/constants/`)

- `keys.ts` — `MESSAGE_KEYS` for background messaging, `STORAGE_KEYS` for persistence
- `config.ts` — `EmbeddingConfig`, `DEFAULT_EMBEDDING_CONFIG`

### Feature Modules (`src/features/`)

Each feature folder should own its UI, hooks, and (if needed) its Zustand store:

- `chat/` — chat UI, streaming hook (`use-chat.ts`), RAG pipeline (`rag/`), speech (`stores/speech-store.ts`)
- `sessions/` — session list + repository, `stores/chat-session-store.ts`
- `model/` — model management UI, provider/embedding settings screens
- `file-upload/` — file ingestion for RAG, per-format processors under `processors/`
- `prompt/` — prompt templates
- `settings/` — settings registry, i18n-backed settings search index, and search/deep-link tests
- `memory/`, `knowledge/`, `context/`, `tabs/` — auxiliary chat-context features

Cross-feature concerns (theme, shortcuts, search dialog) live in `src/stores/`. **Feature-scoped stores live under `features/<x>/stores/`, never in `src/stores/`.**

### RAG / Embeddings

- Live RAG pipeline: `src/features/chat/rag/` (`rag-pipeline.ts`, `rag-retriever.ts`, `rag-prompt-builder.ts`, `query-classifier.ts`).
- Embedding plumbing: `src/lib/embeddings/` (`embedding-strategy.ts`, `embedder-factory.ts`, `hnsw-index.ts`, `keyword-index.ts`, `storage.ts`, `chunker.ts`, `search.ts`).
- Embedding strategy chain: provider-native → shared model → Ollama fallback.
- Hybrid search: keyword (`minisearch`) + dense (`hnsw`) with configurable weights.
- Reranking is a **cosine-similarity re-scorer** (`src/lib/embeddings/reranker.ts`), on by default. It is **not** a cross-encoder. A transformers.js / ONNX Runtime cross-encoder was attempted but blocked by MV3 CSP, so it never shipped; neither library is a dependency. `config.ts` still accepts the legacy `transformers-js`/`onnxruntime-web` backend strings purely as a migration shim that collapses them to `cosine`.

> There is no longer a parallel `src/lib/rag/core/` tree. If you see references to it in any doc, that doc is stale — please update it.

### Web Search Tooling

- Runtime code lives under `src/lib/tools/web-search/`.
- `WebSearchBackend` adapters keep provider-specific wire formats behind one `web_search` tool.
- Supported backends: SearXNG (`GET /search?q=...&format=json`), Brave Search (`GET https://api.search.brave.com/res/v1/web/search` with `X-Subscription-Token`), and Tavily (`POST https://api.tavily.com/search` with bearer auth).
- Settings UI lives under `src/features/web-search/` and mounts in the Context tab. Config is device-local via `STORAGE_KEYS.WEB_SEARCH.CONFIG`; never log API keys.
- SearXNG has `pageno` but no API result-count parameter. Fetch configured pages, de-dupe, then cap output before returning results to the model. Brave uses `count`; Tavily uses `max_results`.
- Keep snippets/titles untrusted. Cap per-result snippets and total tool output, and instruct models to cite returned URLs for current facts.

## Key Conventions

### Messaging keys: provider-* vs ollama-*

`MESSAGE_KEYS` in `src/lib/constants/keys.ts` exposes two namespaces:

- `MESSAGE_KEYS.PROVIDER.*` — current. Use for any new handler. New messages should be sent only with this namespace.
- `MESSAGE_KEYS.OLLAMA.*` — legacy, **only** contains keys whose string value differs from the PROVIDER counterpart (e.g. `"ollama-stream-response"` vs `"provider-stream-response"`). Old in-tab clients during an extension upgrade may still send these strings, so the background dispatcher accepts both. Keys that had identical values between the two namespaces have been removed from this map — they were redundant.

`STORAGE_KEYS.PROVIDER.*` vs `LEGACY_STORAGE_KEYS.OLLAMA.*` follow the same rule.

When adding a new message: declare it only under `PROVIDER_MESSAGE_KEYS`. Do not mirror it into `LEGACY_OLLAMA_MESSAGE_KEYS`.

### Background Handlers (`src/background/handlers/`)

Each handler follows the pattern `handle-{action}.ts` and is registered in `src/background/index.ts`. Keep handlers thin — they should adapt the message protocol to `src/lib/` calls and stream results back through the port.

### Testing

- Framework: Vitest with `happy-dom` and `fake-indexeddb`.
- Test files: `src/**/__tests__/*.{test,spec}.{ts,tsx}` (the `__tests__` directory convention is consistent across the repo).
- Setup: `src/test/setup.ts` mocks chrome APIs and IndexedDB.
- Run a single file: `pnpm test src/path/to/module.test.ts`.

Coverage config (`vitest.config.ts`) excludes only test files, `.d.ts` declarations, and `src/lib/lucide-icon.ts`. UI components, type modules, and barrels are now included so coverage numbers reflect reality.

### Linting / Formatting

Uses Biome (not ESLint/Prettier):

- 2-space indent, LF line endings
- Double quotes, no semicolons (except ASI hazards)
- No trailing commas
- Bracket-same-line for JSX

`__tests__/` files are allowed `noExplicitAny`. Other vendored shadcn-primitive a11y suppressions live as per-line `// biome-ignore` comments inside the offending file — there is no longer a blanket override for `src/components/ui/**`.

### shadcn primitives

`src/components/ui/` is a curated set of in-use shadcn primitives, not the default kitchen-sink install. Before adding a new primitive, check whether an existing one or a small component composition would do. If you add one, verify it is actually imported somewhere before merging.

### React Hook Form fields

When binding form fields to React Hook Form, use the app-owned `Controlled*` wrappers in `src/components/forms/` (`ControlledTextInput`, `ControlledTextarea`, `ControlledNumberInput`, `ControlledSelect`, `ControlledSlider`, `ControlledSwitch`). Do **not** spread `register(...)` into `src/components/ui/*` primitives. Several UI primitives are controlled Base UI wrappers; spread-register can make the DOM look updated while RHF state still holds the old value. The contract test in `src/components/forms/__tests__/react-hook-form-contract.test.ts` enforces this for production TSX.

### Settings search and deep links

`src/features/settings/settings-registry.ts` is the source of truth for options-page settings search and deep-link focus. When adding or moving a setting:

- Add or update a registry entry with the real tab, section, label i18n key, description key, and any visible child strings in `searchKeys`.
- Prefer i18n keys over plain keywords. Use `aliases` only for technical synonyms, provider names, or common typos that are not visible UI copy.
- Every registry `id` or `focusId` should resolve to a mounted element via `focusId`, `id`, or `data-settings-focus-id`. Use `SettingsCard`, `SettingsFormField`, `SettingsSliderField`, or `SettingsSwitch` focus props where available; otherwise add `data-settings-focus="true"` and `data-settings-focus-id="..."`.
- Avoid duplicate focus IDs across tabs. Duplicate IDs make search highlights land on the wrong control after tab navigation.
- Update `src/features/settings/__tests__/settings-registry.test.ts`, `settings-search-index.test.ts`, or the relevant component test when adding search coverage.

### i18n build pipeline

`src/i18n/resources.ts` and Chrome Web Store locale metadata under `public/_locales/<lang>/messages.json` are **generated** from `src/locales/<lang>/translation.json` by `tools/generate-i18n-resources.ts`. The typed resources file is `.gitignored`; `_locales` is committed because extension packages need it.

`src/locales/<lang>/translation.json` is the source of truth for both in-app UI copy and extension package metadata. Keep the top-level `extension` block filled in for every locale, and do not hand-edit `public/_locales/**/messages.json`.

It is regenerated automatically before any build/dev/package command (`pnpm dev`, `pnpm build`, `pnpm package`, and Firefox variants all chain `pnpm generate:resources &&` first), and by `pnpm prepare` (so a fresh `pnpm install` produces the file).

If you change anything under `src/locales/`, run `pnpm generate:resources` manually to refresh the typed map and `_locales` output in your editor. Tests and typecheck do not regenerate — they rely on the file having been produced at install/dev time.

### Git hooks (.husky)

- `pre-commit`: lint-staged (typecheck + format-fix + lint-fix + related tests) → `format:check` → `lint:check` → `typecheck`. **Does not run the full test suite** — that moved to pre-push.
- `pre-push`: `pnpm test:run` (full vitest suite). This is the last safety net before code leaves the machine.

## Important Constraints

- Chrome MV3 CSP restricts dynamic eval; WASM is allowed via `'wasm-unsafe-eval'`. ONNX Runtime is bundled, not fetched.
- Firefox lacks Chrome's `declarativeNetRequest` semantics; provider requests that need cross-origin must rely on `host_permissions: ["<all_urls>"]` plus explicit CORS-friendly endpoints.
- Provider model-name collisions can produce ambiguous routing — `ProviderFactory` resolves via the saved mapping first, Ollama fallback last.
- Token budgeting in `lib/embeddings/chunker.ts` is approximate (`chars / 4`).

## API Documentation Reference

- **Ollama**: <https://github.com/ollama/ollama/blob/main/docs/api.md>
- **LM Studio**: <https://lmstudio.ai/docs/developer/rest/endpoints>
  - `/api/v0/models`: Rich model info (`quantization`, `max_context_length`)
  - `/api/v0/chat/completions`: Chat
  - Standard OpenAI-compatible endpoints also supported.
- **llama.cpp server**: <https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md>
  - `/v1/models`: OpenAI-compatible info (includes `meta` with `size`, `n_params`)
  - `/v1/chat/completions`: Chat completions
  - Default model download location on macOS: `~/Library/Caches/llama.cpp`
  - Example: `llama-server -m ~/Library/Caches/llama.cpp/<model>.gguf --port 8000 --host 0.0.0.0`
- **OpenAI**: <https://platform.openai.com/docs/api-reference>
- **vLLM** (OpenAI-compatible server): <https://docs.vllm.ai/en/latest/serving/openai_compatible_server.html>
- **KoboldCPP** (OpenAI-compatible endpoints): <https://github.com/LostRuins/koboldcpp/wiki>
- **LocalAI** (OpenAI-compatible): <https://localai.io/features/openai-functions/>
- **SearXNG Search API**: <https://docs.searxng.org/dev/search_api.html>
- **Brave Search API**: <https://api-dashboard.search.brave.com/app/documentation/web-search/responses>
- **Tavily Search API**: <https://docs.tavily.com/documentation/api-reference/endpoint/search>

## Known Tech-Debt Hotspots

If you're touching one of these, expect to refactor as you go:

- `src/features/chat/hooks/use-chat-turn-controller.ts` owns turn lifecycle, streaming, abort, thinking, and attachment handoff. Keep `use-chat.ts` as wiring only.
- `src/features/file-upload/hooks/use-file-upload.ts` still owns UI state around ingestion; pipeline helpers live in `file-upload-pipeline.ts`. Continue moving validation, registration, and embedding enqueue logic out of the hook when touching it.
- `src/features/sessions/stores/chat-session-store.ts` is now a thin barrel (~19 LOC) over extracted store slices/actions; persistence reads via `src/lib/repositories/chat-history.ts`. The earlier ~485-LOC god-store has been split — don't go looking for it.
- `src/features/model/components/provider-settings.tsx` delegates provider connection details and custom model editing to small components; keep new provider settings slices similarly scoped and covered by component tests.
- `src/contents/index.ts` is now a thin entry (~38 LOC); selection-capture / dom-observer / messaging have been pulled into siblings.
- `src/types/index.ts` is now a 14-line re-export barrel over six domain files (`chat`, `model`, `messaging`, `errors`, `content-extraction`, `ui-state`). New code should prefer importing from the per-domain path (`@/types/chat`) over the barrel.
- Dexie chat-history paths are retired. Vector storage and knowledge sets still use Dexie; chat history stays SQLite-only through the facade.
