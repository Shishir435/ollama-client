# Ollama Client

Local-first browser sidepanel for chatting with local and remote LLM providers, with private chat history, local RAG, image input, browser-context tools, and optional web search.

<p>
  <a href="https://chromewebstore.google.com/detail/ollama-client/bfaoaaogfcgomkjfbmfepbiijmciinjl">
    <img alt="Chrome Web Store" src="https://img.shields.io/chrome-web-store/v/bfaoaaogfcgomkjfbmfepbiijmciinjl?label=Chrome%20Web%20Store&style=for-the-badge&logo=googlechrome" />
  </a>
  <img alt="Local-first" src="https://img.shields.io/badge/Local--First-Yes-0f766e?style=for-the-badge" />
  <img alt="Providers" src="https://img.shields.io/badge/Providers-6-1d4ed8?style=for-the-badge" />
  <img alt="License" src="https://img.shields.io/badge/License-MIT-111827?style=for-the-badge" />
</p>

**Quick links:** [Install](https://chromewebstore.google.com/detail/ollama-client/bfaoaaogfcgomkjfbmfepbiijmciinjl) · [Docs](https://ollama-client.shishirchaurasiya.in/) · [Provider setup](https://ollama-client.shishirchaurasiya.in/guides/provider-setup/) · [Architecture](https://ollama-client.shishirchaurasiya.in/concepts/architecture/) · [Privacy](https://ollama-client.shishirchaurasiya.in/legal/privacy-policy/) · [Issues](https://github.com/Shishir435/ollama-client/issues)

## What It Does

Ollama Client gives you a browser-native chat workspace for local and bring-your-own remote models:

- Chat from the browser sidepanel with streaming responses and cancellation.
- Route models across Ollama, LM Studio, llama.cpp, vLLM, KoboldCPP, and LocalAI.
- Upload files and use local retrieval-augmented generation over your own content.
- Attach images for vision-capable models.
- Let tool-capable models read the current tab, selected text, open tabs, uploaded files, local memory, and optionally the live web when the prompt calls for it.
- Capture selected page text into chat with the selection-button overlay.
- Keep chat history, sessions, files, settings, and embeddings on your machine by default.
- Export, restore, print, and manage local conversation history.

## Supported Providers

| Provider         | Default endpoint           | Notes                                                                |
| ---------------- | -------------------------- | -------------------------------------------------------------------- |
| Ollama           | `http://localhost:11434`   | Default fallback and fullest local model-management support          |
| LM Studio        | `http://localhost:1234/v1` | OpenAI-compatible chat and embeddings with LM Studio model discovery |
| llama.cpp server | `http://localhost:8000/v1` | OpenAI-compatible server via `llama-server`                          |
| vLLM             | User configured            | OpenAI-compatible local or remote serving                            |
| KoboldCPP        | User configured            | OpenAI-compatible endpoints with KoboldCPP sampler support           |
| LocalAI          | User configured            | OpenAI-compatible multi-backend local serving                        |

Model routing uses saved model-to-provider mappings first. If a mapping is missing, the historical fallback is Ollama.

## Local RAG

The RAG pipeline is browser-first and local-first:

1. Files or chat text are chunked in the extension.
2. Chunks are embedded through provider-native support, a shared embedding model, or Ollama fallback.
3. Hybrid retrieval combines keyword and dense search.
4. Retrieved snippets are injected into the prompt context before generation.

Chat/session/message/file history is SQLite-only through `sql.js`, persisted into IndexedDB. Vector embeddings still live in IndexedDB through the embeddings storage layer.

## Browser Context, Images, and Tools

Ollama Client supports two context paths:

- **Manual context**: select tabs, selected text, files, or images before sending.
- **Model-requested context**: tool-capable models can call tools during a response to inspect the current page, list/read open tabs, search indexed files, search local chat memory, use the most recent selected text, or search the live web when web search is enabled.

Tool calls run inside the extension and are shown in the reasoning trace with status, inputs, sources, and trimmed output previews. They do not create extra chat-history rows; only the final answer and trace metadata are persisted.

Web search is off by default and appears to the model as a single `web_search` tool. Backend choice stays in Settings -> Context, with SearXNG for local/self-hosted search and Brave Search or Tavily through API keys. Search config is device-local, API keys are masked, snippets are capped, and returned titles/snippets are treated as untrusted text.

For local/private web search:

```bash
cd searxng
docker compose up -d
```

Then set the SearXNG endpoint to `http://localhost:8080` in Settings -> Context -> Web Search.

Image input is available only when the selected model resolves to vision-capable. Images are sent in the provider's native request format and stored locally with the conversation so previews reopen later.

## Install

### Chrome Web Store

1. Install from the [Chrome Web Store](https://chromewebstore.google.com/detail/ollama-client/bfaoaaogfcgomkjfbmfepbiijmciinjl).
2. Start at least one provider server.
3. Open extension settings, configure the provider URL, and select a model.
4. Start chatting from the sidepanel.

### Local Development

```bash
git clone https://github.com/Shishir435/ollama-client.git
cd ollama-client
pnpm install
pnpm dev
```

Firefox development:

```bash
pnpm dev:firefox
```

## Common Commands

```bash
pnpm dev                    # Chrome MV3 dev build
pnpm dev:firefox            # Firefox MV2 dev build
pnpm build                  # Chrome production build
pnpm build:firefox          # Firefox production build
pnpm package                # Zip Chrome build
pnpm package:firefox        # Zip Firefox build

pnpm typecheck
pnpm lint:check
pnpm test:run
pnpm verify                 # typecheck + lint + full test suite
pnpm verify:browser-smoke
pnpm verify:browser-automation
```

Before opening a PR, run:

```bash
pnpm verify
```

## Architecture

The extension is built with WXT, React 19, TypeScript 5.9, Tailwind v4, and Biome.

Key paths:

- `src/entrypoints/` - WXT entrypoints for sidepanel, options, background, content scripts, and print export.
- `src/sidepanel/` - main chat shell.
- `src/options/` - settings and configuration shell.
- `src/background/` - runtime message dispatcher and handlers.
- `src/features/` - feature-owned UI, hooks, RAG, stores, and workflows.
- `src/components/forms/`, `src/components/layout/`, `src/components/settings/`, `src/components/feedback/`, `src/components/data-display/` - app-owned frontend primitives.
- `src/components/ui/` - curated shadcn/Base UI primitives only.
- `src/lib/providers/` - provider registry, factory, manager, and provider implementations.
- `src/lib/repositories/chat-history.ts` - chat-history facade backed by SQLite.
- `src/lib/sqlite/` - sql.js database, schema, and migrations.
- `src/lib/embeddings/` - chunking, embedding strategy, HNSW, keyword index, and vector storage.

Runtime flow:

1. Sidepanel sends a provider stream request through a runtime port.
2. Background dispatches to a provider handler.
3. `ProviderFactory` resolves the selected model's provider.
4. Provider streams tokens back through the port.
5. UI state updates and chat history is persisted locally.

## Documentation

- [Provider setup](https://ollama-client.shishirchaurasiya.in/guides/provider-setup/)
- [Context, images, and tools](https://ollama-client.shishirchaurasiya.in/guides/context-and-tools/)
- [Provider capability matrix](https://ollama-client.shishirchaurasiya.in/concepts/provider-matrix/)
- [Architecture](https://ollama-client.shishirchaurasiya.in/concepts/architecture/)
- [Keyboard shortcuts](https://ollama-client.shishirchaurasiya.in/about/keyboard-shortcuts/)
- [Changelog](https://ollama-client.shishirchaurasiya.in/about/changelog/)
- [Privacy policy](https://ollama-client.shishirchaurasiya.in/legal/privacy-policy/)
- [Contributing guide](./CONTRIBUTING.md)
- [AI assistant guide](./AGENTS.md)

Search provider API references:

- [SearXNG Search API](https://docs.searxng.org/dev/search_api.html)
- [Brave Search API](https://api-dashboard.search.brave.com/app/documentation/web-search/responses)
- [Tavily Search API](https://docs.tavily.com/documentation/api-reference/endpoint/search)

Docs site source lives in `docs/`. The changelog and provider matrix docs pages are generated by `pnpm docs:generate` from root/source files, so do not hand-edit `docs/src/content/docs/about/changelog.md` or `docs/src/content/docs/concepts/provider-matrix.md`. The docs build output goes to `docs/dist/` for Vercel. Generated extension locale metadata under `public/_locales/` comes from `src/locales/<lang>/translation.json`; do not hand-edit generated locale files.

## Privacy

Ollama Client does not include a built-in telemetry pipeline. Your privacy depends on the providers you configure:

- Local providers keep requests on your machine or local network.
- Remote providers receive the prompts, context, and files snippets you send to them.
- Remote search providers receive search queries when web search is enabled and selected.
- Chat history and RAG data are stored locally by default.

Do not expose local provider APIs publicly without authentication and network controls.

## Contributing

Keep changes scoped, testable, and aligned with the existing feature boundaries. New chat-history work should go through `src/lib/repositories/chat-history.ts`; new provider work should update the provider registry, factory, manager defaults, tests, and provider docs.

See [CONTRIBUTING.md](./CONTRIBUTING.md) and [AGENTS.md](./AGENTS.md) for the full contributor workflow.

## License

MIT License: [LICENCE](./LICENCE)
