---
title: Provider Setup
description: Configure Ollama, LM Studio, llama.cpp, or any OpenAI-compatible local server to chat with local LLMs from your browser.
---

Recommended setup is Ollama as the primary provider, with LM Studio and llama.cpp as alternatives. Any OpenAI-compatible server (vLLM, LocalAI, KoboldCPP) also works once configured. This guide reflects `v0.6.x` behavior.

## 1. Install the extension

Install [Ollama Client](https://chromewebstore.google.com/detail/ollama-client-chat-with-l/bfaoaaogfcgomkjfbmfepbiijmciinjl) from the Chrome Web Store.

## 2. Pick a provider

| Provider | Default endpoint | Notes |
|---|---|---|
| Ollama | `http://localhost:11434` | Recommended baseline. Full feature support (pull, delete, version). |
| LM Studio | `http://localhost:1234/v1` | OpenAI-compatible. Chat + embeddings. |
| llama.cpp server | `http://localhost:8000/v1` | OpenAI-compatible. Run with `llama-server`. |
| vLLM / LocalAI / KoboldCPP | `http://localhost:8000/v1` | Any OpenAI-compatible server; use your actual URL. |

## 3. Start Ollama (primary path)

Install Ollama from [ollama.com](https://ollama.com), then start it:

```bash
ollama serve
```

Pull at least one chat model:

```bash
ollama pull qwen2.5:3b
```

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
- Pull / delete / unload / version actions are Ollama-only.
- Embedding generation currently flows through Ollama; other providers can read embeddings but not produce them.

## 7. CORS and browser notes

Chrome-based browsers route extension requests through Declarative Net Request (DNR). Firefox uses a different extension API model.

:::caution[Firefox + Ollama]
On Firefox or strict environments, you may need to set `OLLAMA_ORIGINS` to allow the extension origin. The helper script linked above handles this for common setups.
:::

## 8. Troubleshooting

- Confirm the provider process is actually running.
- Confirm the endpoint URL matches the runtime URL exactly (port, scheme, `/v1` suffix).
- Use the **Test connection** button in Providers settings before debugging model behavior.
- Check the background console (`chrome://extensions` → service worker) for streaming or provider errors.

## Related

- [Architecture](/concepts/architecture/)
- [Privacy policy](/legal/privacy-policy/)
- [GitHub repository](https://github.com/Shishir435/ollama-client)
