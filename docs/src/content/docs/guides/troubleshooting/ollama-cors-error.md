---
title: Fix Ollama CORS errors in browser extensions
description: Resolve 403 Forbidden and CORS errors when Ollama Client connects to a local Ollama server from Chrome or Firefox.
---

A `403 Forbidden` or CORS error on Ollama Client 0.14 or earlier usually means
Ollama rejected the browser extension origin.

From 0.15, the extension removes the `Origin` header from its own requests to
every provider you have configured, in Chromium browsers and in Firefox, so
Ollama never sees an extension origin to reject and `OLLAMA_ORIGINS` is not
needed. A `403` there comes from the server or a proxy in front of it: check
the API key in provider settings, the proxy's access rules, and the server
log. The steps below still apply to older versions.

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

These installers pipe a remote script into your shell. To pin the release and verify it first, see [installing without piping to a shell](/developers/#install-without-piping-to-a-shell).

Ollama itself must already be installed. `olc --debug` provides foreground
diagnostics. Use `olc --lan` only when trusted-network access is intended;
Ollama has no native API authentication. olc passes `OLLAMA_*` only to a
standalone Ollama child; the values disappear when that process stops and olc
does not write them to the system or user environment.

On macOS, if the running Ollama app lacks the required origins, olc gracefully
quits it and starts a standalone Ollama process. Stop that standalone process
before reopening the app; the app's own configuration remains unchanged.

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

From 0.15, both remove `Origin` from the extension's provider requests:
Chromium through declarativeNetRequest rules, Firefox through a `webRequest`
listener. Requests that web pages or other extensions send to the same server
keep their `Origin`, so Ollama's own origin check still protects it from
websites. On 0.14 and earlier, Firefox needs the explicit `OLLAMA_ORIGINS`
value.

## OpenAI-compatible local servers

LM Studio, llama.cpp, vLLM, LocalAI, and KoboldCPP may have their own
CORS/origin settings. If you see a local `401` or `403` from one of these
servers, check that its API server accepts browser-extension origins and that
the base URL in Ollama Client points to the local OpenAI-compatible endpoint.

## FAQ

### Is this an API key problem?

On 0.14 and earlier, usually no for local providers: a local `403` often means
origin rejection. From 0.15 the server never sees the extension's origin, so a
`403` is the server or a proxy refusing the request itself.

### Do I need both Chrome and Firefox origins?

Using both is convenient if you test the extension in multiple browsers.

### Is `OLLAMA_ORIGINS="*"` safe?

Prefer the narrower browser-extension origins shown above. Use broader origins
only if you understand the local network exposure.
