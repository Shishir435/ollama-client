---
name: Bug report
about: Something is broken or behaving unexpectedly in the extension
title: "bug: "
labels: bug
assignees: ""
---

<!--
Before opening: please search existing issues so we don't end up
with duplicates. If your problem looks like a security vulnerability,
do NOT file it here — see SECURITY.md instead.
-->

## What happened

<!-- A clear, one-paragraph description of the bug. Include the
     error message verbatim if there is one. -->

## Reproduction steps

1.
2.
3.

## Expected behavior

## Environment

- **Extension version** (sidepanel header → Settings → About, or `chrome://extensions`): <!-- e.g. 0.6.5 -->
- **Browser build**: <!-- Chrome MV3 / Firefox MV2 / Edge / Brave / other -->
- **Browser version**: <!-- e.g. Chrome 132 -->
- **Operating system**: <!-- e.g. macOS 14.5, Windows 11, Ubuntu 24.04 -->

## Provider

- **Provider and its version**: <!-- e.g. Ollama 0.13.5 (`ollama -v`), LM Studio 0.3.30, llama.cpp b6500 -->
- **Model**: <!-- e.g. qwen3:8b, glm-5.3:cloud -->
- **Local or remote**: <!-- local (same machine), LAN, or remote / behind a proxy -->
- **Support code**: <!-- shown on the error bubble; or "Copy diagnostics" on the failed message -->

## Server log around the failure

<!--
The extension only sees the status code; the reason is in the server's log.
Paste the lines from the moment it failed:
  - Ollama: the `ollama serve` output, `~/.ollama/logs/server.log` (macOS),
    `journalctl -u ollama` (Linux), or `%LOCALAPPDATA%\Ollama\server.log` (Windows)
  - LM Studio: Developer → Server logs
  - llama.cpp / other: the server's console output
-->

```
<paste here>
```

## Feature area (check all that apply)

- [ ] Chat / streaming
- [ ] Model selection / provider settings
- [ ] RAG (file upload, retrieval, knowledge sets)
- [ ] Tab context / page extraction
- [ ] Sessions / history / export-import
- [ ] Embedding download or migration
- [ ] Storage / data reset (Dexie ↔ SQLite migration)
- [ ] Options page / settings
- [ ] Content script (selection button on web pages)
- [ ] Other:

## Console / extension logs

<!--
Open DevTools on the sidepanel:
  - Right-click inside the sidepanel → Inspect
  - Or for the background worker: chrome://extensions → "Service worker"
Paste any red errors or warnings below. Trim aggressively; the most
recent 20–40 lines around the error are usually enough.
-->

```
<paste here>
```

## Screenshots / GIFs

<!-- Drag-and-drop into this box. Optional but extremely helpful for
     UI bugs and streaming weirdness. -->

## Additional context

<!--
Anything else that might matter:
  - Did this start after a specific extension update?
  - Did you switch storage backends recently (the SQLite migration
    notification)?
  - Tab access enabled?  Grounded-only mode on?  RAG enabled?
  - Particular site you were on when a content-script bug happened?
-->
