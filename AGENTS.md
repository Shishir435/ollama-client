# AGENTS.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

## Project Overview

Browser extension (Chrome/Firefox) for chatting with local LLM providers (Ollama, LM Studio, llama.cpp). Built with WXT framework, React, TypeScript, and Tailwind CSS.

## Development Commands

```bash
pnpm install          # Install dependencies
pnpm -C apps/extension dev              # Start dev server (Chrome)
pnpm -C apps/extension dev:firefox      # Start dev server (Firefox)
pnpm -C apps/extension build            # Production build (Chrome)
pnpm -C apps/extension build:firefox    # Production build (Firefox)
pnpm -C apps/extension test:run         # Run all tests
pnpm -C apps/extension test -- path/to/file.test.ts  # Run single test file
pnpm -C apps/extension lint:check       # Check linting (Biome)
pnpm -C apps/extension lint:fix         # Fix lint issues
```

Run `pnpm -C apps/extension lint:check && pnpm -C apps/extension test:run` before opening PRs.

## Architecture

### Entry Points (WXT Extension)

- **Sidepanel** (`apps/extension/src/entrypoints/sidepanel.tsx` → `apps/extension/src/sidepanel/app.tsx`): Main chat UI
- **Options** (`apps/extension/src/entrypoints/options.tsx` → `apps/extension/src/options/app.tsx`): Settings/configuration
- **Background** (`apps/extension/src/background/index.ts`): Service worker for provider communication, streaming, embedding
- **Content scripts** (`apps/extension/src/contents/`): Page extraction, selection capture

### Data Flow

1. UI sends prompt via runtime port (`MESSAGE_KEYS.PROVIDER.STREAM_RESPONSE`)
2. Background resolves provider using `ProviderFactory.getProviderForModel(modelId)`
3. Provider streams tokens back through port
4. UI updates state and persists to Dexie (IndexedDB)

### Provider System (`apps/extension/src/lib/providers/`)

- `types.ts`: `LLMProvider` interface, `ProviderConfig`, `ProviderType`, `ProviderId` enums
- `factory.ts`: `ProviderFactory` resolves provider by model mapping
- `manager.ts`: `ProviderManager` handles config and model mappings via `ProviderStorageKey`
- Individual providers: `ollama.ts`, `lm-studio.ts`, `llama-cpp.ts`, `openai.ts`

**Important**: Default fallback is Ollama when model mapping is absent.

### Storage

- **Chat/sessions/files**: Dexie (`apps/extension/src/lib/db.ts`) - primary runtime store
- **Vectors/embeddings**: Dexie (`apps/extension/src/lib/embeddings/db.ts`)
- **Settings/config**: `@plasmohq/storage` via `plasmoGlobalStorage` wrapper
- **SQLite**: Migration/auxiliary path only, not primary store

### Key Constants (`apps/extension/src/lib/constants/`)

- `keys.ts`: `MESSAGE_KEYS` for background messaging, `STORAGE_KEYS` for persistence
- `config.ts`: `EmbeddingConfig`, `DEFAULT_EMBEDDING_CONFIG`

### Feature Modules (`apps/extension/src/features/`)

- `chat/`: Chat UI components, hooks (`use-chat-stream.ts`), RAG pipeline
- `sessions/`: Session management, `chat-session-store.ts`
- `model/`: Model management UI
- `file-upload/`: File processing for RAG

### RAG/Embeddings (`apps/extension/src/lib/embeddings/`, `apps/extension/src/features/chat/rag/`)

- Embedding strategy chain: provider-native → shared model → Ollama fallback
- Hybrid search: keyword + semantic with configurable weights
- Cross-encoder reranker: Enabled by default using transformers.js with bundled ONNX Runtime WASM
- Browser-first contracts: `apps/extension/src/lib/rag/core/interfaces.ts`

## Key Conventions

### Legacy Naming

Legacy `ollama-*` keys retained for backward compatibility alongside `provider-*` keys. Both are defined in `apps/extension/src/lib/constants/keys.ts`:
- `MESSAGE_KEYS.PROVIDER.*` (current)
- `MESSAGE_KEYS.OLLAMA.*` (legacy, still read for compatibility)
- `STORAGE_KEYS.PROVIDER.*` vs `LEGACY_STORAGE_KEYS.OLLAMA.*`

### Background Handlers (`apps/extension/src/background/handlers/`)

Each handler follows pattern: `handle-{action}.ts`. Handlers are registered in `apps/extension/src/background/index.ts`.

### Testing

- Framework: Vitest with happy-dom
- Test files: `apps/extension/src/**/*.{test,spec}.{ts,tsx}`
- Setup: `apps/extension/src/test/setup.ts` mocks chrome APIs and IndexedDB
- Run related tests: `pnpm -C apps/extension test -- --run apps/extension/src/path/to/module`

### Linting/Formatting

Uses Biome (not ESLint/Prettier):
- 2-space indent, LF line endings
- Double quotes, no semicolons (except ASI hazards)
- No trailing commas

## Important Constraints

- Chrome extension CSP requires bundled WASM files (ONNX Runtime bundled for reranker)
- Firefox lacks Chrome DNR API behavior - requires explicit CORS setup
- Provider model naming collisions can cause ambiguous routing
- Token budgeting is approximate (`chars / 4`)

## API Documentation Reference

- **Llama.cpp**: [Server README](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md)
  - `/v1/models`: OpenAI-compatible info (includes `meta` with `size`, `n_params`)
  - `/v1/completions`: Text completions
  - `/v1/chat/completions`: Chat completions

  > llmaa.cpp model downlaod location  `~/Library/Caches/llama.cpp`
  
  ```bash
  llama-server -m ~/Library/Caches/llama.cpp/ggml-org_gemma-3-1b-it-GGUF_gemma-3-1b-it-Q4_K_M.gguf --port 8000 --host 0.0.0.0
  ```

- **LM Studio**: [REST API Endpoints](https://lmstudio.ai/docs/developer/rest/endpoints)
  - `/api/v0/models`: Rich model info (`quantization`, `max_context_length`)
  - `/api/v0/chat/completions`: Chat
  - Standard OpenAI-compatible endpoints also supported.

- **Ollama**: [API Documentation](https://github.com/ollama/ollama/blob/main/docs/api.md)
