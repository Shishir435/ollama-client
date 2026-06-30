---
title: Fix Ollama CORS errors in browser extensions
description: Resolve 403 Forbidden and CORS errors when Ollama Client connects to a local Ollama server from Chrome or Firefox.
---

A `403 Forbidden` or CORS error usually means Ollama rejected the browser
extension origin. This is most common in Firefox, where extensions cannot use the
same declarative network request CORS workaround that Chromium supports.

## Quick fix

Start Ollama with browser-extension origins allowed:

```bash
OLLAMA_ORIGINS="chrome-extension://*,moz-extension://*" ollama serve
```

Then reopen Ollama Client and retry the connection.

## macOS persistent setup

If Ollama runs as a launch service, set `OLLAMA_ORIGINS` in the service
environment and restart Ollama.

For a shell session:

```bash
export OLLAMA_ORIGINS="chrome-extension://*,moz-extension://*"
ollama serve
```

## Linux systemd setup

Create or edit an Ollama service override:

```bash
sudo systemctl edit ollama
```

Add:

```ini
[Service]
Environment="OLLAMA_ORIGINS=chrome-extension://*,moz-extension://*"
```

Reload and restart:

```bash
sudo systemctl daemon-reload
sudo systemctl restart ollama
```

## Windows PowerShell setup

Set the environment variable before starting Ollama:

```powershell
$env:OLLAMA_ORIGINS="chrome-extension://*,moz-extension://*"
ollama serve
```

For a persistent user variable:

```powershell
[Environment]::SetEnvironmentVariable("OLLAMA_ORIGINS", "chrome-extension://*,moz-extension://*", "User")
```

Restart Ollama after changing the value.

## Chrome vs Firefox

Chromium browsers can use extension-side CORS rules in more cases. Firefox is
stricter, so the Ollama server often needs the explicit `OLLAMA_ORIGINS` value.

## OpenAI-compatible local servers

LM Studio, llama.cpp, vLLM, LocalAI, and KoboldCPP may have their own
CORS/origin settings. If you see a local `401` or `403` from one of these
servers, check that its API server accepts browser-extension origins and that
the base URL in Ollama Client points to the local OpenAI-compatible endpoint.

## FAQ

### Is this an API key problem?

Usually no for local providers. A local `403` often means origin/CORS rejection,
not bad credentials.

### Do I need both Chrome and Firefox origins?

Using both is convenient if you test the extension in multiple browsers.

### Is `OLLAMA_ORIGINS="*"` safe?

Prefer the narrower browser-extension origins shown above. Use broader origins
only if you understand the local network exposure.
