# AGENTS.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

## Project Overview

Browser extension (Chrome/Firefox) for chatting with local LLM providers (Ollama, LM Studio, llama.cpp). Built with WXT framework, React, TypeScript, and Tailwind CSS.

## Development Commands

```bash
pnpm install          # Install dependencies
pnpm dev              # Start dev server (Chrome)
pnpm dev:firefox      # Start dev server (Firefox)
pnpm build            # Production build (Chrome)
pnpm build:firefox    # Production build (Firefox)
pnpm test:run         # Run all tests
pnpm test -- path/to/file.test.ts  # Run single test file
pnpm lint:check       # Check linting (Biome)
pnpm lint:fix         # Fix lint issues
```

Run `pnpm lint:check && pnpm test:run` before opening PRs.

## Architecture

### Entry Points (WXT Extension)

- **Sidepanel** (`src/entrypoints/sidepanel.tsx` → `src/sidepanel/app.tsx`): Main chat UI
- **Options** (`src/entrypoints/options.tsx` → `src/options/app.tsx`): Settings/configuration
- **Background** (`src/background/index.ts`): Service worker for provider communication, streaming, embedding
- **Content scripts** (`src/contents/`): Page extraction, selection capture

### Data Flow

1. UI sends prompt via runtime port (`MESSAGE_KEYS.PROVIDER.STREAM_RESPONSE`)
2. Background resolves provider using `ProviderFactory.getProviderForModel(modelId)`
3. Provider streams tokens back through port
4. UI updates state and persists to Dexie (IndexedDB)

### Provider System (`src/lib/providers/`)

- `types.ts`: `LLMProvider` interface, `ProviderConfig`, `ProviderType`, `ProviderId` enums
- `factory.ts`: `ProviderFactory` resolves provider by model mapping
- `manager.ts`: `ProviderManager` handles config and model mappings via `ProviderStorageKey`
- Individual providers: `ollama.ts`, `lm-studio.ts`, `llama-cpp.ts`, `openai.ts`

**Important**: Default fallback is Ollama when model mapping is absent.

### Storage

- **Chat/sessions/files**: Dexie (`src/lib/db.ts`) - primary runtime store
- **Vectors/embeddings**: Dexie (`src/lib/embeddings/db.ts`)
- **Settings/config**: `@plasmohq/storage` via `plasmoGlobalStorage` wrapper
- **SQLite**: Migration/auxiliary path only, not primary store

### Key Constants (`src/lib/constants/`)

- `keys.ts`: `MESSAGE_KEYS` for background messaging, `STORAGE_KEYS` for persistence
- `config.ts`: `EmbeddingConfig`, `DEFAULT_EMBEDDING_CONFIG`

### Feature Modules (`src/features/`)

- `chat/`: Chat UI components, hooks (`use-chat-stream.ts`), RAG pipeline
- `sessions/`: Session management, `chat-session-store.ts`
- `model/`: Model management UI
- `file-upload/`: File processing for RAG

### RAG/Embeddings (`src/lib/embeddings/`, `src/features/chat/rag/`)

- Embedding strategy chain: provider-native → shared model → Ollama fallback
- Hybrid search: keyword + semantic with configurable weights
- CSP constraint: Reranker disabled by default (transformers.js incompatible)
- Browser-first contracts: `src/lib/rag/core/interfaces.ts`

## Key Conventions

### Legacy Naming

Legacy `ollama-*` keys retained for backward compatibility alongside `provider-*` keys. Both are defined in `src/lib/constants/keys.ts`:
- `MESSAGE_KEYS.PROVIDER.*` (current)
- `MESSAGE_KEYS.OLLAMA.*` (legacy, still read for compatibility)
- `STORAGE_KEYS.PROVIDER.*` vs `LEGACY_STORAGE_KEYS.OLLAMA.*`

### Background Handlers (`src/background/handlers/`)

Each handler follows pattern: `handle-{action}.ts`. Handlers are registered in `src/background/index.ts`.

### Testing

- Framework: Vitest with happy-dom
- Test files: `src/**/*.{test,spec}.{ts,tsx}`
- Setup: `src/test/setup.ts` mocks chrome APIs and IndexedDB
- Run related tests: `pnpm test -- --run src/path/to/module`

### Linting/Formatting

Uses Biome (not ESLint/Prettier):
- 2-space indent, LF line endings
- Double quotes, no semicolons (except ASI hazards)
- No trailing commas

## Important Constraints

- Chrome extension CSP limits WASM/worker ML paths (reranker disabled)
- Firefox lacks Chrome DNR API behavior - requires explicit CORS setup
- Provider model naming collisions can cause ambiguous routing
- Token budgeting is approximate (`chars / 4`)
