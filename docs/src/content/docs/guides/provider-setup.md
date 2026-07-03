---
title: Provider Setup
description: Configure Ollama, LM Studio, llama.cpp, Anthropic, or any OpenAI-compatible server.
---

Verified built-ins are Ollama, LM Studio, and llama.cpp. Add vLLM, LocalAI, KoboldCPP, or another compatible endpoint through **Add provider**. Anthropic uses its native Messages API and sends selected chat context to Anthropic.

Web search is configured separately in the Context tab. Use SearXNG for local/self-hosted search, or Brave Search/Tavily when you want an API-backed provider.

## 1. Install the extension

Install [Ollama Client](https://chromewebstore.google.com/detail/ollama-client-chat-with-l/bfaoaaogfcgomkjfbmfepbiijmciinjl) from the Chrome Web Store.

## 2. Pick a provider

| Provider | Default endpoint | Notes |
|---|---|---|
| Ollama | `http://localhost:11434` | Recommended baseline. Tool calling plus fullest model-management support. |
| LM Studio | `http://localhost:1234/v1` | OpenAI-compatible chat, embeddings, tool calling, and LM Studio model discovery. |
| llama.cpp server | `http://localhost:8000/v1` | OpenAI-compatible. Run with `llama-server`. |
| OpenAI-compatible | User configured | Add vLLM, LocalAI, KoboldCPP, or another compatible endpoint. |
| Anthropic | `https://api.anthropic.com/v1` | Remote Claude Messages API; API key required. |

## 3. Start Ollama (primary path)

Install Ollama from [ollama.com](https://ollama.com), then start it:

```bash
ollama serve
```

Pull at least one chat model:

```bash
ollama pull qwen2.5:3b
```

For tool calling and image input, choose a model that actually supports those capabilities. The extension detects reported capabilities where providers expose them, and lets you override them from the model menu when a provider cannot report them.

Pull one embeddings model for RAG:

```bash
ollama pull all-minilm:latest
```

You need at least one chat model and one embeddings model installed for the full experience.

:::tip[Helper script]
Need help with LAN or Firefox origin setup? See [`tools/ollama-env.sh`](https://github.com/Shishir435/ollama-client/blob/main/tools/ollama-env.sh) in the repo.
:::

## 4. Configure the extension

1. Open the extension's options page.
2. Go to the **Providers** tab.
3. Enable the providers you want.
4. Set the base URL and run a connection test.
5. Pick a model from the chat model menu.

## 5. Verify endpoints

```bash
# Ollama
curl http://localhost:11434/api/tags

# LM Studio
curl http://localhost:1234/v1/models

# llama.cpp
curl http://localhost:8000/v1/models
```

## 6. Reality checks

- Chat generation is fully provider-agnostic.
- Image input is model-dependent. If the selected model is not vision-capable, the composer blocks image attach instead of sending unsupported input.
- Tool calling is model-dependent. Ollama and LM Studio both expose tool-calling APIs, but the selected model still needs tool-use support. Tool-capable models can inspect browser context through local extension tools; non-tool models keep the old plain chat path.
- Web search is off by default and model-visible only as `web_search`. Backend choice is a user setting, not a model prompt detail.
- Model-management actions depend on provider capabilities. Ollama has the fullest support; LM Studio adds pull/unload support.
- Embedding generation uses the configured provider when supported, then falls back through the shared embedding path and Ollama for reliability.

## 7. Optional local web search with SearXNG

The repo includes a local SearXNG compose stack for private web-search testing.

```bash
cd searxng
docker compose up -d
```

Then open Settings -> Context -> Web Search:

1. Enable web search.
2. Pick `SearXNG`.
3. Set endpoint to `http://localhost:8080`.
4. Run **Test search**.

SearXNG supports `pageno`, not an API-side result-count parameter. Ollama Client can fetch 1-3 pages, de-dupe URLs, then apply the configured result-count cap before returning results to the model.

## 8. Search provider API references

- [SearXNG Search API](https://docs.searxng.org/dev/search_api.html)
- [Brave Search API](https://api-dashboard.search.brave.com/app/documentation/web-search/responses)
- [Tavily Search API](https://docs.tavily.com/documentation/api-reference/endpoint/search)

## 9. CORS and browser notes

Chrome-based browsers route extension requests through Declarative Net Request (DNR). Firefox uses a different extension API model.

:::caution[Firefox + Ollama]
On Firefox or strict environments, you may need to set `OLLAMA_ORIGINS` to allow the extension origin. The helper script linked above handles this for common setups.
:::

## 10. Troubleshooting

- Confirm the provider process is actually running.
- Confirm the endpoint URL matches the runtime URL exactly (port, scheme, `/v1` suffix).
- Use the **Test connection** button in Providers settings before debugging model behavior.
- For web search, use **Test search** in Context settings and verify your SearXNG endpoint or API key.
- Check the background console (`chrome://extensions` → service worker) for streaming or provider errors.

## Related

- [Architecture](/concepts/architecture/)
- [Context, Images, and Tools](/guides/context-and-tools/)
- [Privacy policy](/legal/privacy-policy/)
- [GitHub repository](https://github.com/Shishir435/ollama-client)
