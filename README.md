# Ollama Client: Local LLM Chrome Extension for Private AI Chat

A local-first browser extension for chat with local LLM providers (Ollama, LM Studio, llama.cpp) from the browser sidepanel.

<p>
  <a href="https://chromewebstore.google.com/detail/ollama-client/bfaoaaogfcgomkjfbmfepbiijmciinjl">
    <img alt="Chrome Web Store" src="https://img.shields.io/chrome-web-store/v/bfaoaaogfcgomkjfbmfepbiijmciinjl?label=Chrome%20Web%20Store&style=for-the-badge&logo=googlechrome" />
  </a>
  <img alt="Local-first" src="https://img.shields.io/badge/Local--First-Yes-0f766e?style=for-the-badge" />
  <img alt="Providers" src="https://img.shields.io/badge/Providers-Ollama%20%7C%20LM%20Studio%20%7C%20llama.cpp-1d4ed8?style=for-the-badge" />
  <img alt="License" src="https://img.shields.io/badge/License-MIT-111827?style=for-the-badge" />
</p>

**Quick links:** [Install](https://chromewebstore.google.com/detail/ollama-client/bfaoaaogfcgomkjfbmfepbiijmciinjl) · [Docs](https://ollama-client.shishirchaurasiya.in/) · [Setup Guide](https://ollama-client.shishirchaurasiya.in/ollama-setup-guide) · [Privacy](https://ollama-client.shishirchaurasiya.in/privacy-policy) · [Issues](https://github.com/Shishir435/ollama-client/issues)

## What This Project Is

Ollama Client is a sidepanel chat extension for Chromium browsers, with Firefox support.

It is a local LLM Chrome extension where you choose provider endpoints and models.

Version `v0.6.0` introduced multi-provider chat routing and local RAG workflows.

## Who This Is For (and Who It Is Not For)

### This is for

- Developers who want an Ollama client directly in the browser UI.
- Users who want an offline AI assistant workflow with local storage by default.
- Users running local provider servers (Ollama, LM Studio, llama.cpp).
- Contributors interested in browser extension + local model architecture.

### This is not for

- Users expecting cloud-SaaS reliability without running local infrastructure.
- Teams requiring centralized cloud sync, SSO, and org admin controls.
- Users who do not want to manage provider endpoints.

## What Problem It Solves

Most AI browser tools assume hosted providers and account-based workflows.

This project focuses on local-first usage:

- You configure the model endpoint.
- Chat/session data is stored locally.
- There is no built-in telemetry pipeline.

## How It Differs From Alternatives

- Sidepanel-native browser UX instead of a separate desktop app.
- Multi-provider routing in one UI.
- Built-in local retrieval flow (RAG with local LLMs).
- Source-visible behavior for auditing and contribution.

## Feature Coverage and Limits

| Major feature | What works now | Current limitation |
|---|---|---|
| Multi-provider chat | Route chat to Ollama, LM Studio, llama.cpp | Routing defaults to Ollama if model mapping is missing |
| Model management | Pull/delete/unload/version support for Ollama | Equivalent management actions are not yet implemented for LM Studio/llama.cpp |
| Streaming | Token streaming via runtime port with cancel support | Message keys and some hook names still use legacy `ollama-*` naming |
| RAG with local LLMs | Local chunking, embedding, hybrid retrieval, context injection | Embeddings currently use Ollama embedding APIs |
| File ingestion | TXT/MD/PDF/DOCX/CSV/TSV/PSV/HTML processing | Quality depends on file quality and chunking config |
| Persistence | Chat/session/files and vectors stored in Dexie/IndexedDB | SQLite exists as migration/auxiliary path, not primary runtime store |
| Browser support | Chromium workflow and Firefox workflow are supported | Firefox may need explicit origin/CORS setup |

## Architecture Overview

High-level flow:

1. Sidepanel/options UI collects prompt and settings.
2. UI opens runtime port to background.
3. Background resolves provider by selected model mapping.
4. Provider stream is relayed back to UI in chunks.
5. UI updates message state and persists chat data.
6. Optional RAG pipeline retrieves local context and appends it to prompt input.

Key directories:

- `src/sidepanel/*`
- `src/options/*`
- `src/background/*`
- `src/contents/*`
- `src/lib/providers/*`
- `src/lib/embeddings/*`

Build/runtime notes:

- Extension framework: WXT (`wxt` CLI)
- Settings hooks/storage wrapper: `@plasmohq/storage` (`plasmoGlobalStorage`)

## Supported Providers

Default provider profiles:

- Ollama (`http://localhost:11434`)
- LM Studio (`http://localhost:1234/v1`)
- llama.cpp server (`http://localhost:8000/v1`)

Clarifying examples:

- If both Ollama and LM Studio expose `llama3`, mapping decides which backend handles chat.
- If mapping is absent for a model ID, fallback provider is Ollama.

## RAG With Local LLMs

In this project, RAG means local retrieval before generation:

1. Uploaded or chat text is chunked.
2. Chunks are embedded and stored in local vector storage.
3. Query-time retrieval selects relevant chunks.
4. Retrieved snippets are appended to generation context.

Clarifying example:

- Upload a local API spec PDF, then ask: `What headers are required for createUser?`
- Retrieved chunks from that PDF are included in prompt context before model response.

## Installation

### For users

1. Install extension from the Chrome Web Store.
2. Start at least one provider endpoint.
3. Configure provider URL in settings.
4. Select a model and start chatting in the sidepanel.

Common endpoint examples:

- `http://localhost:11434` (Ollama)
- `http://localhost:1234/v1` (LM Studio)
- `http://localhost:8000/v1` (llama.cpp server)

### For contributors

```bash
git clone https://github.com/Shishir435/ollama-client.git
cd ollama-client
pnpm install
pnpm dev
```

Common commands:

```bash
pnpm lint:check
pnpm test:run
pnpm build
pnpm package
```

Firefox commands:

```bash
pnpm dev:firefox
pnpm build:firefox
pnpm package:firefox
```

## Basic Usage Flow

1. Start provider service.
2. Open extension settings and verify connection.
3. Select model.
4. Send prompt and monitor stream.
5. Optionally upload files for retrieval context.
6. Fork conversation by editing earlier user messages.

## Advanced Usage

### Provider and model control

- Enable only providers you need.
- Keep model names unique when possible.
- Re-check mappings after model list changes.

### Parameter tuning

- Per-model parameters are stored locally (`temperature`, `top_p`, `top_k`, etc.).
- Start with defaults, then tune one variable at a time.

### RAG tuning

- Adjust chunk size/overlap and retrieval thresholds.
- Narrow retrieval scope when debugging noisy answers.

## Limitations and Known Issues

- Legacy key/message naming (`ollama-*`) remains in parts of multi-provider code.
- Embeddings are currently Ollama-dependent.
- Reranker exists but is disabled by default due extension CSP constraints.
- Provider parity is incomplete for model management actions.
- Runtime persistence is Dexie-first while SQLite migration path still exists.

## Security and Privacy Notes

- Privacy depends on endpoint choice.
- If you configure a remote endpoint, prompts/responses are sent to that endpoint.
- Do not expose provider APIs publicly without access controls.

## Roadmap (Short and Realistic)

1. Provider-agnostic naming cleanup.
2. Clear single-source persistence strategy.
3. Better provider parity for management actions.
4. Better retrieval diagnostics.

## Contributing (Summary)

- Read [CONTRIBUTING.md](./CONTRIBUTING.md).
- Keep PRs scoped and testable.
- Include reproduction details for bug fixes.
- Update docs when behavior changes.

## Philosophy and Non-Goals

Philosophy:

- Local-first operation.
- Explicit behavior over hidden automation.
- User control of endpoint and model settings.

Non-goals:

- Managed cloud LLM platform behavior.
- Hidden telemetry for growth metrics.
- Abstracting away all local infrastructure responsibility.

## License

MIT License: [LICENCE](./LICENCE)

## Documentation Map

- [Architecture Guide](./docs/architecture.md)
- [Provider Support](./docs/providers.md)
- [RAG Guide](./docs/rag.md)
- [Contributing Guide](./CONTRIBUTING.md)
- [Setup Guide (Web)](https://ollama-client.shishirchaurasiya.in/ollama-setup-guide)
- [Privacy Policy (Web)](https://ollama-client.shishirchaurasiya.in/privacy-policy)
