---
title: Fix Ollama CORS errors in browser extensions
description: Resolve 403 Forbidden and CORS errors when Ollama Client connects to a local Ollama server from Chrome or Firefox.
---

A `403 Forbidden` or CORS error usually means Ollama rejected the browser
extension origin. This is most common in Firefox, where extensions cannot use the
same declarative network request CORS workaround that Chromium supports.

## Choose a setup method

olc is optional. It automates the same Ollama environment configuration shown
in the manual instructions below.

### Automatic setup with olc

Install **olc**, then let it add and verify the browser-extension origins:

```bash
# macOS / Linux
curl -fsSL https://ollamaclient.in/olc.sh | sh
olc
olc --check --json
```

```powershell
# Windows PowerShell
irm https://ollamaclient.in/olc.ps1 | iex
olc
olc --check --json
```

Ollama itself must already be installed. `olc --debug` provides foreground
diagnostics. Use `olc --lan` only when trusted-network access is intended;
Ollama has no native API authentication. olc passes `OLLAMA_*` only to a
standalone Ollama child; the values disappear when that process stops and olc
does not write them to the system or user environment.

If olc reports that an app, tray process, or protected service must be configured
through its owner, use the matching manual setup below.

### Manual setup without olc

#### macOS Ollama app

Set the launch-session environment, fully quit Ollama, and reopen it:

```bash
launchctl setenv OLLAMA_ORIGINS "chrome-extension://*,moz-extension://*"
osascript -e 'quit app "Ollama"'
open -a Ollama
```

This value lasts until logout. Remove it with
`launchctl unsetenv OLLAMA_ORIGINS`.

#### macOS or Linux shell server

Stop the existing server, then start a shell-owned server with the variable:

```bash
export OLLAMA_ORIGINS="chrome-extension://*,moz-extension://*"
ollama serve
```

#### Linux systemd service

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

#### Windows PowerShell

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

### Verify the manual setup

Confirm that Ollama answers a request carrying an extension origin:

```bash
curl -i -H 'Origin: moz-extension://cors-probe' \
  http://127.0.0.1:11434/api/version
```

An HTTP `200` response means Ollama accepted the origin. A `403` means the
running process did not inherit `OLLAMA_ORIGINS`; fully stop it and repeat the
matching platform steps.

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
