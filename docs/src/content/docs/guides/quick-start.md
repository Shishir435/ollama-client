---
title: Start chatting with a local model
description: Start Ollama, LM Studio, or llama.cpp, connect Ollama Client, and send your first message.
---

Use this guide to send your first message with a local model. You need a model
provider running on your computer and at least one chat model installed.
Install the extension for
[Chrome, Edge, or Brave](https://chromewebstore.google.com/detail/ollama-client-chat-with-l/bfaoaaogfcgomkjfbmfepbiijmciinjl)
or [Firefox](https://addons.mozilla.org/en-US/firefox/addon/ollama-client/).

## 1. Start your provider

Choose the provider you already use.

### Ollama

Start Ollama and install a chat model if you have not already:

```bash
ollama serve
ollama pull qwen2.5:3b
```

Ollama usually runs at `http://localhost:11434`.

### LM Studio

Open LM Studio, download a chat model, then start its local server. LM Studio
usually uses `http://localhost:1234/v1`.

### llama.cpp

Start `llama-server` with a model file. Its default address is
`http://localhost:8000/v1`.

For another provider, see [Provider Setup](/guides/provider-setup/).

## 2. Connect the extension

Open Ollama Client's side panel. In first-run setup, choose the provider you
already run. If you skipped setup, open **Settings → Providers & models**, add
or select your provider, and test the connection.

If the connection fails, follow [Ollama CORS troubleshooting](/guides/troubleshooting/ollama-cors-error/)
or the relevant section in [Provider Setup](/guides/provider-setup/).

## 3. Choose a model and chat

Choose an installed chat model from the model menu, then send a message. The
answer appears in the side panel, and the chat is stored in your browser.

## Add files or page context later

You do not need to configure embeddings to start chatting. New installs use a
bundled embedding model for local file search. You can add files from
**Knowledge & web** or page context from **Page & tabs** when you need them.

## Common questions

### Does this require OpenAI?

No. You can chat with local providers without an OpenAI account. Remote
providers send the prompt data needed for a request to the endpoint you chose.

### What if the model list is empty?

Check that the provider is running, the address is correct, and a chat model is
installed. Some compatible servers do not publish a model list; see
[Provider Setup](/guides/provider-setup/#endpoints-that-do-not-list-models).

### Why do tools not work?

Tool calling depends on the selected model. Check the model's capabilities and
the enabled tools under **Privacy & permissions**.

For more answers, see the [FAQ](/about/faq/).
