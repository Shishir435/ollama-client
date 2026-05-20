# AGENTS.md

Guidance for AI coding assistants (Claude Code, Cursor, Warp, Copilot, etc.) working in this repository.

## Project Overview

Browser extension (Chrome MV3 / Firefox MV2) for chatting with local and remote LLM providers, with local-first RAG over uploaded files. Built with WXT, React 19, TypeScript 5.9, Tailwind v4, and Biome.

Supported providers (all live, all in `src/lib/providers/`): **Ollama, LM Studio, llama.cpp, OpenAI, vLLM, KoboldCPP, LocalAI**.

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

pnpm docs:dev               # Astro dev for the marketing/docs site (docs-src/)
pnpm docs:build             # Astro build → docs/ (committed for GitHub Pages)

pnpm generate:resources     # Regenerate src/i18n/resources.ts from src/locales/
```

Run `pnpm typecheck && pnpm lint:check && pnpm test:run` before opening a PR.

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
- Individual provider implementations: `ollama.ts`, `lm-studio.ts`, `llama-cpp.ts`, `openai.ts`, `vllm.ts`, `koboldcpp.ts`, `localai.ts`. OpenAI-compatible subclasses are picked from a small `OPENAI_COMPAT_CONSTRUCTORS` map inside `factory.ts`; anything not in that map falls back to plain `OpenAIProvider`.

**Default fallback** is Ollama when no explicit model→provider mapping exists.

### Storage

Storage is currently mid-migration from Dexie → sql.js (SQLite-in-WASM):

- **Chat / sessions / files / attachments**: Dexie (`src/lib/db.ts`) is still the live runtime store.
- **SQLite**: `src/lib/sqlite/` (`db.ts`, `schema.ts`, `migrations/`). The Dexie→SQLite migration and the on-install `runEmbeddingDimensionMigration` both live under `src/lib/migration/`. Background `src/background/index.ts` invokes the latter from `onInstalled`; UI hooks (e.g. `src/hooks/use-sqlite-migration.ts`) drive the former. There is no `src/background/migrations/` directory anymore.
- **Vectors / embeddings**: `src/lib/embeddings/` (HNSW + keyword index). Vector storage lives in IndexedDB via `lib/embeddings/storage.ts`.
- **Settings / config / per-extension state**: `@plasmohq/storage` accessed through `src/lib/plasmo-global-storage.ts`.

When picking a storage layer for new work, prefer SQLite (`src/lib/sqlite/`) — the long-term direction is to retire Dexie.

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
- `memory/`, `knowledge/`, `context/`, `tabs/` — auxiliary chat-context features

Cross-feature concerns (theme, shortcuts, search dialog) live in `src/stores/`. **Feature-scoped stores live under `features/<x>/stores/`, never in `src/stores/`.**

### RAG / Embeddings

- Live RAG pipeline: `src/features/chat/rag/` (`rag-pipeline.ts`, `rag-retriever.ts`, `rag-prompt-builder.ts`, `query-classifier.ts`).
- Embedding plumbing: `src/lib/embeddings/` (`embedding-strategy.ts`, `embedder-factory.ts`, `hnsw-index.ts`, `keyword-index.ts`, `storage.ts`, `chunker.ts`, `search.ts`).
- Embedding strategy chain: provider-native → shared model → Ollama fallback.
- Hybrid search: keyword (`minisearch`) + dense (`hnsw`) with configurable weights.
- Cross-encoder reranker is on by default using transformers.js with bundled ONNX Runtime WASM.

> There is no longer a parallel `src/lib/rag/core/` tree. If you see references to it in any doc, that doc is stale — please update it.

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

### i18n build pipeline

`src/i18n/resources.ts` is **generated** from `src/locales/<lang>/translation.json` by `tools/generate-i18n-resources.ts`. The file is `.gitignored`.

It is regenerated automatically before any build/dev/package command (`pnpm dev`, `pnpm build`, `pnpm package`, and Firefox variants all chain `pnpm generate:resources &&` first), and by `pnpm prepare` (so a fresh `pnpm install` produces the file).

If you change anything under `src/locales/`, run `pnpm generate:resources` manually to refresh the typed map in your editor. Tests and typecheck do not regenerate — they rely on the file having been produced at install/dev time.

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

## Known Tech-Debt Hotspots

If you're touching one of these, expect to refactor as you go:

- `src/features/chat/hooks/use-chat.ts` (god-hook, ~737 LOC; split along stream / abort / thinking / attachments seams)
- `src/features/sessions/stores/chat-session-store.ts` (repository logic mixed into a Zustand store; extract persistence into `src/lib/repositories/`)
- `src/features/model/components/provider-settings.tsx` and `embedding-settings.tsx` (each ~600+ LOC, no direct tests; split per provider section)
- `src/contents/index.ts` (large content script, no tests; split into selection-capture / dom-observer / messaging)
- `src/types/index.ts` is now a 14-line re-export barrel over six domain files (`chat`, `model`, `messaging`, `errors`, `content-extraction`, `ui-state`). New code should prefer importing from the per-domain path (`@/types/chat`) over the barrel.
- Dexie → SQLite migration not yet finished — both paths run. Long-term direction is SQLite-only.
