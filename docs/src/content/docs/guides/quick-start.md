---
title: Ollama quick start in Chrome or Firefox
description: Connect Ollama Client to Ollama, LM Studio, or llama.cpp and send your first local AI chat from the browser side panel.
---

Ollama Client lets you chat with a local LLM from the browser side panel. The
fastest path is: start a local provider, install the extension, choose a model,
and send your first message.

## 1. Start a local provider

Use any supported local or OpenAI-compatible server.

### Ollama

```bash
ollama serve
ollama pull llama3.2
```

Default URL: `http://localhost:11434`

### LM Studio

Open LM Studio, start the local server, and load a model.

Default URL: `http://localhost:1234/v1`

### llama.cpp server

```bash
llama-server -m ~/Library/Caches/llama.cpp/model.gguf --port 8000 --host 0.0.0.0
```

Default URL: `http://localhost:8000/v1`

## 2. Install Ollama Client

Install the extension, open the side panel, and go to **Setup** if the provider
connection is not detected automatically.

Use [Provider Setup](/guides/provider-setup/) for full provider-specific
configuration.

## 3. Pick a model

Open the model selector and choose a model from your provider. If a model list is
empty, check that the provider is running and that the base URL matches the
server.

## 4. Send your first message

Ask a normal question. Ollama Client streams the answer into the side panel and
stores the chat locally.

## 5. Add page context or files

After the first chat works, enable the context controls you need:

- **Page & tabs** for current-page and tab context.
- **Knowledge & web** for uploaded files, local RAG, and optional web search.
- **Privacy & permissions** for browser permissions and model-callable tools.

## Common first-run problems

### The provider says 403 or CORS

Firefox and strict local servers may reject browser-extension origins. For
Ollama, set:

```bash
OLLAMA_ORIGINS="chrome-extension://*,moz-extension://*" ollama serve
```

See [Fix Ollama CORS errors](/guides/troubleshooting/ollama-cors-error/).

### The model list is empty

Confirm the provider is running, the base URL is correct, and at least one model
is available locally.

### Chat works but tools do not

Tool calling depends on model capability plus the enabled tool family settings.
Check **Privacy & permissions** for the live tool inventory.

## FAQ

### Does this require OpenAI?

No. Ollama Client works with local and self-hosted providers. OpenAI-compatible
means the server speaks the OpenAI API shape; it does not require OpenAI.

### Does chat history stay local?

Yes. Chat history is stored locally in browser extension storage.

### Can I use this as an Open WebUI alternative?

Yes, if you want a browser extension and side panel instead of a self-hosted web
app.
