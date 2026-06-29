---
title: Local-first privacy in Ollama Client
description: How Ollama Client stores chats, files, settings, permissions, and model requests for private local AI workflows.
---

Ollama Client is designed around local-first AI chat. The extension stores user
data in browser storage and sends prompts only to the provider endpoint you
configure.

## What stays on your device?

These data types are stored locally by the extension:

- Chat sessions and messages
- Uploaded-file metadata and local retrieval indexes
- Knowledge sets and embeddings
- Provider settings and model mappings
- Web-search configuration
- Browser permission state and feature settings

Chat history uses SQLite-in-WASM persisted to IndexedDB. Vector storage and
knowledge sets use local IndexedDB storage.

## What can leave your device?

Prompt data leaves your device only when needed for the provider you choose.

If your provider is local, such as Ollama at `http://localhost:11434` or LM
Studio at `http://localhost:1234/v1`, requests stay on your machine. If you
configure a remote OpenAI-compatible server, prompts and selected context are
sent to that remote server.

Optional web search can contact the backend you configure, such as SearXNG,
Brave Search, or Tavily.

## Browser permissions are explicit

Browser features such as tab access, recently closed sessions, screenshots, and
downloads are controlled through extension permissions and visible settings. The
model-tools inventory in **Privacy & permissions** shows which tools are
available and why.

## Page and tab context are scoped

Ollama Client can read current-page or tab context only when the related setting
and browser access allow it. Excluded and unreadable URLs are filtered before
content is used for chat or model-callable tools.

## Uploaded files and local RAG

Uploaded files are processed locally for retrieval. The extension can store
chunks and embeddings in browser storage so future chats can retrieve relevant
context.

## Web search is optional

Web search is off unless configured. When enabled, the model can use the selected
web-search backend through the tool system. API keys are stored locally and are
not logged by the extension.

## Reset and backup

The Data & backup settings let you export or reset local data. Reset maps include
provider configuration and API keys so a provider reset removes stored secrets.

## FAQ

### Is Ollama Client private by default?

It is local-first by default. Privacy still depends on the provider endpoint and
optional features you enable.

### Does Ollama Client index browser history automatically?

Browser knowledge features are optional and permission-gated. Keep them disabled
if you do not want browser history or bookmarks available for local retrieval.

### Where should I check permissions?

Open **Privacy & permissions** in settings. It shows browser permissions, tool
families, and per-model tool availability.
