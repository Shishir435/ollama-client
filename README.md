# Ollama Client: Local LLM Chrome Extension for Private AI Chat

A local-first browser extension for chat with local and remote LLM providers — Ollama, LM Studio, llama.cpp, OpenAI, vLLM, KoboldCPP, LocalAI — from the browser sidepanel, with local RAG over your own files.

<p>
  <a href="https://chromewebstore.google.com/detail/ollama-client/bfaoaaogfcgomkjfbmfepbiijmciinjl">
    <img alt="Chrome Web Store" src="https://img.shields.io/chrome-web-store/v/bfaoaaogfcgomkjfbmfepbiijmciinjl?label=Chrome%20Web%20Store&style=for-the-badge&logo=googlechrome" />
  </a>
  <img alt="Local-first" src="https://img.shields.io/badge/Local--First-Yes-0f766e?style=for-the-badge" />
  <img alt="Providers" src="https://img.shields.io/badge/Providers-7-1d4ed8?style=for-the-badge" />
  <img alt="License" src="https://img.shields.io/badge/License-MIT-111827?style=for-the-badge" />
</p>

**Quick links:** [Install](https://chromewebstore.google.com/detail/ollama-client/bfaoaaogfcgomkjfbmfepbiijmciinjl) · [Docs](https://ollama-client.shishirchaurasiya.in/) · [Setup Guide](https://ollama-client.shishirchaurasiya.in/guides/provider-setup/) · [Architecture](https://ollama-client.shishirchaurasiya.in/concepts/architecture/) · [Privacy](https://ollama-client.shishirchaurasiya.in/legal/privacy-policy/) · [Issues](https://github.com/Shishir435/ollama-client/issues)

## What This Project Is

Ollama Client is a sidepanel chat extension for Chromium browsers, with Firefox support.

It is a local LLM Chrome extension where you choose provider endpoints and models.

Version `v0.6.0` introduced multi-provider chat routing and local RAG workflows.

## Who This Is For (and Who It Is Not For)

### This is for

- Developers who want an Ollama (or LM Studio / llama.cpp) client directly in the browser UI.
- Users who want an offline AI assistant workflow with local storage by default.
- Users running local provider servers (Ollama, LM Studio, llama.cpp, vLLM, KoboldCPP, LocalAI) and/or routing some traffic to hosted OpenAI from the same UI.
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
| Multi-provider chat | Route chat to Ollama, LM Studio, llama.cpp, OpenAI, vLLM, KoboldCPP, LocalAI | Routing defaults to Ollama if model mapping is missing |
| Model management | Pull/delete/unload/version support for Ollama | Equivalent management actions are not yet implemented for the other providers |
| Streaming | Token streaming via runtime port with cancel support | Message keys and some hook names still use legacy `ollama-*` naming |
| RAG with local LLMs | Local chunking, embedding, hybrid retrieval, context injection | Embeddings use provider-native/shared routes with Ollama fallback for reliability |
| File ingestion | TXT/MD/PDF/DOCX/CSV/TSV/PSV/HTML processing | Quality depends on file quality and chunking config |
| Persistence | Chat / sessions / messages / files live in SQLite (sql.js, persisted to IndexedDB). Vectors stay on Dexie. | Dexie auto-fallback is kept as a recovery target during the SQLite cutover window; the chat-history facade routes back to it if SQLite ever ends up sparser than Dexie. |
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

- `src/entrypoints/*` — WXT entry shells (background / sidepanel / options / print / content scripts)
- `src/sidepanel/*` — sidepanel chat UI
- `src/options/*` — settings / options UI
- `src/background/*` — background service worker handlers + dispatch
- `src/contents/*` — content-script feature modules (selection capture, page extraction)
- `src/lib/providers/*` — LLM provider classes + factory + registry
- `src/lib/embeddings/*` — chunker, vector store, hybrid search
- `src/lib/repositories/*` — chat-history facade (Dexie + SQLite)
- `src/lib/sqlite/*` — sql.js init, schema, migrations

Build/runtime notes:

- Extension framework: WXT (`wxt` CLI)
  > moved from Plasmo to WXT for more deterministic MV3 builds and explicit entrypoint/manifest control.
- Settings hooks/storage wrapper: `@plasmohq/storage` (`plasmoGlobalStorage`)

## Supported Providers

Local (default profiles):

- **Ollama** — `http://localhost:11434`
- **LM Studio** — `http://localhost:1234/v1`
- **llama.cpp server** — `http://localhost:8000/v1`
- **vLLM** (OpenAI-compatible server) — user-configured endpoint
- **KoboldCPP** (OpenAI-compatible endpoints) — user-configured endpoint
- **LocalAI** — user-configured endpoint

Remote:

- **OpenAI** — bring-your-own API key

Clarifying examples:

- If both Ollama and LM Studio expose `llama3`, the model→provider mapping decides which backend handles chat.
- If mapping is absent for a model ID, the fallback provider is Ollama.
- Provider implementations live in `src/lib/providers/`; the active registry is `src/lib/providers/registry.ts`.

## RAG With Local LLMs

In this project, RAG means local retrieval before generation:

1. Uploaded or chat text is chunked.
2. Chunks are embedded and stored in local vector storage.
3. Query-time retrieval selects relevant chunks.
4. Retrieved snippets are appended to generation context.

Clarifying example:

- Upload a local API spec PDF, then ask: `What headers are required for createUser?`
- Retrieved chunks from that PDF are included in prompt context before model response.

### Browser-Only RAG Runtime Constraints

Current RAG runtime is intentionally browser-first:

- extension context only (UI + background worker)
- IndexedDB + in-memory index/cache
- HTTP-based model/embedding access
- graceful fallback over hard failure

Embedding strategy defaults:

- provider-native embeddings when available
- shared canonical target: `all-MiniLM-L6-v2`
- silent background warmup
- Ollama fallback for reliability

RAG implementation details and module boundaries:

- Pipeline entrypoint: `src/features/chat/rag/rag-pipeline.ts`
- Retriever: `src/features/chat/rag/rag-retriever.ts`
- Prompt assembly: `src/features/chat/rag/rag-prompt-builder.ts`
- Query classifier: `src/features/chat/rag/query-classifier.ts`
- Embedding plumbing (chunker, HNSW index, keyword index, storage): `src/lib/embeddings/`

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

### Verify Across Browsers (No Manual Steps)

Run this command to automatically verify CSP + browser-specific permission behavior:

```bash
pnpm verify:browser-smoke
```

Run local browser automation (sequential Chromium then Firefox):

```bash
pnpm verify:browser-automation
```

To require Ollama connectivity during automation:

```bash
OLLAMA_REQUIRED=true OLLAMA_BASE_URL=http://localhost:11434 pnpm verify:browser-automation
```

What this command checks:

- Builds Chrome and Firefox artifacts.
- Asserts CSP `connect-src` contains extension-safe local/remote patterns.
- Asserts Chrome keeps `declarativeNetRequest` and `sidePanel`.
- Asserts Firefox removes Chrome-only permissions.
- Asserts required shared permissions and host permissions exist.

Expected outcome:

- Pass: prints `Browser smoke verification passed`.
- Fail: exits non-zero with a specific missing/invalid manifest or CSP assertion.

For full release confidence, use:

```bash
pnpm lint:check && pnpm test:run && pnpm verify:browser-smoke
```

Firefox note:

- Firefox cannot use Chrome DNR CORS workaround; provider-side CORS must be configured.
- Use [`tools/ollama-env.sh`](./tools/ollama-env.sh) in `firefox` mode for Ollama.

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
- Embedding support varies by provider; fallback keeps Ollama as reliability anchor.
- Reranker exists but is disabled by default due to extension CSP constraints.
- Provider parity is incomplete for model management actions.
- Runtime chat-history persistence is SQLite-first; Dexie remains as an auto-fallback recovery target during the cutover window. Vector embeddings still live on Dexie.

## Security and Privacy Notes

- Privacy depends on endpoint choice.
- If you configure a remote endpoint, prompts/responses are sent to that endpoint.
- Do not expose provider APIs publicly without access controls.

## Roadmap (Short and Realistic)

1. Provider-agnostic naming cleanup.
2. Clear single-source persistence strategy.
3. Better provider parity for management actions.
4. Better retrieval diagnostics.

## Future Direction (Documentation Only)

Potential future architecture may include a desktop helper/local companion for heavier retrieval workloads.

Important constraints:

- this is not implemented
- browser-only mode remains first-class
- core runtime does not depend on helper availability

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

- [Architecture (Web)](https://ollama-client.shishirchaurasiya.in/concepts/architecture/)
- [Provider Setup (Web)](https://ollama-client.shishirchaurasiya.in/guides/provider-setup/)
- [Provider Capability Matrix (Web)](https://ollama-client.shishirchaurasiya.in/concepts/provider-matrix/)
- [API Reference (Web)](https://ollama-client.shishirchaurasiya.in/reference/)
- [Privacy Policy (Web)](https://ollama-client.shishirchaurasiya.in/legal/privacy-policy/)
- [Contributing Guide](./CONTRIBUTING.md)
- [AGENTS.md](./AGENTS.md) — guidance for AI coding assistants (Claude Code, Cursor, Warp, Copilot)

Site source: [`docs-src/`](./docs-src/) (Astro) → built into [`docs/`](./docs/) and served via GitHub Pages.
