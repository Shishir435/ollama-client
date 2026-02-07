# Ollama Client: Local LLM Chrome Extension for Private AI Chat

A local-first, privacy-first browser extension for running chat workflows with local models through Ollama, LM Studio, and llama.cpp.

## What This Project Is

Ollama Client is a sidepanel-based AI chat extension for Chromium browsers (and supports Firefox ) that lets you run LLM conversations against provider endpoints you control.

It started as an Ollama client and now includes multi-provider routing and local RAG features added in `v0.6.0`.

## Who This Is For (and Who It Is Not For)

### This is for

- Developers who want a **local LLM Chrome extension** instead of a hosted chatbot tab.
- Privacy-focused users who want an **offline AI assistant** workflow with local storage.
- Power users running local model servers (Ollama, LM Studio, llama.cpp).
- Contributors interested in browser-extension + LLM infra.

### This is not for

- Users expecting hosted-model reliability without running local infrastructure.
- Teams needing centralized cloud sync, org-wide admin tooling, or managed auth.
- Users who want a pure web SaaS experience with zero local setup.

## Why This Exists

Most browser AI tools are cloud-first. This project is intentionally local-first:

- Your inference endpoint is configurable and user-controlled.
- Chat/session data stays in browser-local storage by default.
- No mandatory telemetry pipeline in the extension.

## How It Differs From Alternatives

- **Browser-native UX**: sidepanel integration instead of separate desktop app.
- **Provider abstraction**: one UI with provider routing for local backends.
- **Local retrieval workflow**: built-in **RAG with local LLMs** via file/chat embeddings.
- **Open-source first**: feature behavior is inspectable in code.

## Key Features

- Multi-session chat with tree-style branching/forking
- Streaming responses with stop/cancel
- Provider-aware model selection
- File ingestion: TXT/MD/PDF/DOCX/CSV/TSV/PSV/HTML
- Local semantic search and retrieval context injection
- Message/session export and import
- Prompt templates and text-to-speech controls
- Content extraction from pages/tabs with site overrides
- Chat branching/forking

## Architecture Overview (High Level)

Runtime shape:

1. UI (`sidepanel` and `options`) collects input and settings.
2. UI opens a runtime port to background for generation.
3. Background resolves provider for selected model and streams tokens.
4. Stream deltas return to UI; messages are persisted locally.
5. Embedding + retrieval flows use local vector storage and config.

Core contexts:

- `src/sidepanel/*`
- `src/options/*`
- `src/background/*`
- `src/contents/*`

## Supported Providers (v0.6.0)

Default provider profiles in-app:

- `Ollama` (primary/default)
- `LM Studio integration` (OpenAI-compatible local endpoint)
- `llama.cpp browser integration` (OpenAI-compatible local endpoint)

Important support boundaries:

- Chat streaming is provider-routed.
- Model pull/delete/unload/version flows are currently Ollama-specific.
- Embedding generation is currently pinned to Ollama provider APIs.

## RAG With Local LLMs (What It Means Here)

In this project, RAG means:

- File/chat content is chunked and embedded locally.
- Embeddings are stored in local vector storage (IndexedDB via Dexie).
- Query-time retrieval combines keyword + semantic search.
- Retrieved snippets are appended to prompt context before generation.

Current retrieval pipeline includes:

- Adaptive hybrid scoring
- MMR-based diversity filtering
- Recency boost and feedback-aware blending hooks

CSP constraint note:

- Cross-encoder reranking code exists but is disabled by default in extension context.

## Installation

### For users

1. Install extension from Chrome Web Store:
   - [Ollama Client](https://chromewebstore.google.com/detail/ollama-client/bfaoaaogfcgomkjfbmfepbiijmciinjl)
2. Start a provider endpoint:
   - Ollama default: `http://localhost:11434`
   - LM Studio default profile: `http://localhost:1234/v1`
   - llama.cpp default profile: `http://localhost:8000/v1`
3. Open extension settings → `Providers` and configure/test endpoints.
4. Pick a model and start chatting in sidepanel.

### For contributors

```bash
git clone https://github.com/Shishir435/ollama-client.git
cd ollama-client
pnpm install
pnpm dev
```

Other common commands:

```bash
pnpm lint:check
pnpm test:run
pnpm build
pnpm package
```

Firefox:

```bash
pnpm dev:firefox
pnpm build:firefox
pnpm package:firefox
```

## Basic Usage Flow

1. Start provider server(s).
2. Verify provider connection in settings.
3. Select model from model menu.
4. Send message; watch streaming response.
5. Optionally upload files for retrieval context.
6. Branch/fork conversations by editing prior user messages.

## Advanced Usage

### Provider and model control

- Enable multiple providers; keep only needed endpoints active.
- Use provider routing mappings created from discovered models.
- Keep model naming unique to avoid ambiguous provider mappings.

### Parameter tuning

Per-model parameters are stored locally (`temperature/top_p/top_k/etc.`).
Use conservative defaults first, then tune for task-specific behavior.

### RAG and embedding controls

- Configure chunking strategy/size/overlap.
- Adjust similarity thresholds and retrieval depth.
- Enable/disable automatic embedding workflows.
- Use file-scoped retrieval when debugging noisy results.

## Limitations and Known Issues

This section is intentionally explicit.

- Provider naming and storage keys still include legacy `ollama-*` identifiers.
- Chat/session persistence uses Dexie runtime; SQLite migration exists but is not the primary live chat store yet.
- Embeddings currently depend on Ollama endpoints even when chat uses another provider.
- Reranker implementation is disabled by default due extension CSP constraints.
- Some model-management actions remain Ollama-only (pull/delete/unload/version).
- Firefox requires manual CORS/origin handling; Chrome uses DNR-based workaround paths.

## Roadmap (Short and Realistic)

Near-term focus:

1. Unify provider-agnostic naming across keys/hooks/messages.
2. Clarify and finalize primary persistence strategy (Dexie vs SQLite runtime).
3. Expand provider parity for model-management operations.
4. Improve retrieval transparency and debugging UX.

## Contributing (Summary)

- Read [CONTRIBUTING.md](./CONTRIBUTING.md) before opening a PR.
- Keep changes scoped and testable.
- Include reproduction steps for bug fixes.
- Update docs in the same PR when behavior changes.

## Philosophy, Non-Goals, and Expectations

### Philosophy

- Local-first over cloud-first.
- Explicit tradeoffs over hidden automation.
- User control over endpoints, storage, and model behavior.

### Non-goals

- Becoming a managed cloud LLM platform.
- Hiding infrastructure complexity behind marketing claims.
- Collecting telemetry to optimize growth metrics.

### Expectation warning

If your local provider is misconfigured, overloaded, or offline, extension UX will degrade. This project does not replace the need to operate your model runtime correctly.

## License

MIT License [LICENCE](./LICENCE).

## Documentation Map

- [Architecture Guide](./docs/architecture.md)
- [Provider Support](./docs/providers.md)
- [RAG & Search Guide](./docs/rag.md)
- [Contributing Guide](./CONTRIBUTING.md)
- [Ollama Setup Guide](https://ollama-client.shishirchaurasiya.in/ollama-setup-guide)
- [Privacy Policy](https://ollama-client.shishirchaurasiya.in/privacy-policy)
