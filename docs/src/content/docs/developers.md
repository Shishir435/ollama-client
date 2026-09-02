---
title: Ollama Client developer portal
description: Integrate with Ollama Client's local olc OpenAI-compatible proxy, including setup, authentication, endpoints, errors, tools, and its OpenAPI specification.
---

Ollama Client is a browser extension, not a hosted inference service. The website at `ollamaclient.in` publishes documentation and machine-readable resources; it does not accept prompts or expose users' models.

The project includes **olc**, a local CLI. Bare `olc` starts or reuses native Ollama on port `11434` with extension access. With `-b codex` or `-b opencode`, it runs a proxy that exposes an agent runtime through an OpenAI-compatible HTTP API. Use it when an OpenAI-compatible client needs to reach an OpenCode-backed agent and preserve client-owned function calls. The published [OpenAPI 3.1 specification](/openapi.json) describes this local API and deliberately lists loopback servers.

## Quickstart

olc requires Node.js 22.12 or newer plus the selected runtime on `PATH`:
Ollama for native mode, OpenCode, or Codex CLI with an existing `codex login`.
macOS/Linux native mode also requires `lsof` for process inspection.

Install the published release bundle directly:

```powershell
# Windows PowerShell
irm https://ollamaclient.in/olc.ps1 | iex
```

```bash
# macOS / Linux
curl -fsSL https://ollamaclient.in/olc.sh | sh
```

Both installers download checksum-verified archives from the GitHub release.
Pin version `0.13.2` with the shell-specific commands below:

```bash
export OLC_VERSION=0.13.2
curl -fsSL https://ollamaclient.in/olc.sh | sh
```

```powershell
$env:OLC_VERSION = "0.13.2"
irm https://ollamaclient.in/olc.ps1 | iex
```

### Install without piping to a shell

`ollamaclient.in/olc.sh` and `olc.ps1` are convenience wrappers served from a
mutable URL. Both verify the archive they download against its published
`sha256`, but the one-line commands fetch and execute the wrapper in a single
step, so there is nothing to check or read before it runs with your privileges.

Every release publishes both wrappers alongside the archives, each with its own
`sha256`. Pin one to a tag, verify it, read it, and only then run it:

```bash
tag=0.13.3
base="https://github.com/Shishir435/ollama-client/releases/download/$tag"
curl -fsSL "$base/olc.sh" -o olc.sh
curl -fsSL "$base/olc.sh.sha256" -o olc.sh.sha256
if command -v sha256sum >/dev/null; then sha256sum -c olc.sh.sha256; else shasum -a 256 -c olc.sh.sha256; fi
less olc.sh
OLC_VERSION="$tag" sh olc.sh
```

```powershell
$tag = "0.13.3"
$base = "https://github.com/Shishir435/ollama-client/releases/download/$tag"
irm "$base/olc.ps1" -OutFile olc.ps1
irm "$base/olc.ps1.sha256" -OutFile olc.ps1.sha256
$expected = (Get-Content olc.ps1.sha256).Split(" ")[0]
if ((Get-FileHash olc.ps1 -Algorithm SHA256).Hash -ne $expected) { throw "checksum mismatch" }
Get-Content olc.ps1
$env:OLC_VERSION = $tag
Unblock-File olc.ps1
powershell -ExecutionPolicy Bypass -File ./olc.ps1
```

A file downloaded rather than piped carries the mark of the web, so PowerShell
blocks it until `Unblock-File` clears the mark; the explicit policy on that one
invocation avoids changing the machine's default.

Or skip the wrapper and take the release archive for a chosen tag directly. This
is the same artifact the wrapper would install, and nothing but `tar` runs:

```bash
tag=0.13.3
base="https://github.com/Shishir435/ollama-client/releases/download/$tag"
curl -fsSL "$base/olc.tar.gz" -o olc.tar.gz
curl -fsSL "$base/olc.tar.gz.sha256" -o olc.tar.gz.sha256
if command -v sha256sum >/dev/null; then sha256sum -c olc.tar.gz.sha256; else shasum -a 256 -c olc.tar.gz.sha256; fi
tar -xzf olc.tar.gz
node olc/dist/olc.mjs --help
```

```powershell
$tag = "0.13.3"
$base = "https://github.com/Shishir435/ollama-client/releases/download/$tag"
irm "$base/olc.tar.gz" -OutFile olc.tar.gz
irm "$base/olc.tar.gz.sha256" -OutFile olc.tar.gz.sha256
$expected = (Get-Content olc.tar.gz.sha256).Split(" ")[0]
if ((Get-FileHash olc.tar.gz -Algorithm SHA256).Hash -ne $expected) { throw "checksum mismatch" }
tar -xzf olc.tar.gz
node olc/dist/olc.mjs --help
```

Each checksum is published beside the file it covers on the same release, so it
shows the download arrived intact — not that the file behind a tag is still the
one you reviewed. The release workflow never overwrites a published asset (a
re-run on a moved tag uploads only what is missing), but release assets can still
be changed by hand, and a checksum served from the same place as its file is not
an independent signature. For a pin that does not depend on any of that, record
the hash of a release you have checked and compare against it on later installs.

Move the extracted `olc` directory wherever you keep tools and put `olc.mjs`
on `PATH` under whatever name you prefer; the wrapper's only extra job is
choosing those locations for you.

```bash
# Source checkout alternative
git clone https://github.com/Shishir435/ollama-client.git
cd ollama-client
pnpm install
pnpm proxy:opencode --api-key "replace-with-a-long-random-token"
# or, after `codex login`:
pnpm proxy:codex --api-key "replace-with-a-long-random-token"
```

After upgrading to the release containing native mode (older bundles default to
OpenCode), use the same command format for each backend:

```bash
olc                        # native Ollama: 127.0.0.1:11434
olc --lan                  # native Ollama: 0.0.0.0:11434
olc --local                # explicitly restore loopback
olc --check --json         # read-only native readiness for scripts/agents
olc -b codex               # Codex proxy: 127.0.0.1:8083
olc --backend opencode     # OpenCode proxy: 127.0.0.1:8084
olc -b codex --debug       # foreground, with verbose diagnostics
olc -b opencode --foreground # foreground, normal logging
```

All modes detach by default. Use `--foreground` to stay attached, or `--debug`
for foreground diagnostics; `--detached` makes the default explicit. Detached
proxies report a ready URL, PID, and private log file under `~/.olc/logs/`
(`OLC_LOG_DIR` overrides it). Startup failures return a nonzero exit code.
Use `--foreground` with process supervisors and containers. Existing/app-managed
Ollama stays under its original owner: foreground mode monitors it, and Ctrl-C
exits only the monitor. A new standalone foreground server stops with the session.

Native mode uses the built-in Ollama provider and keeps Ollama's own API.
Existing compatible access is preserved by bare `olc`; restarting an owned
standalone process interrupts active work. Ollama has no native API-key
protection, so use LAN only on a trusted network. olc never changes launchctl,
systemd, Windows user/machine variables, shell profiles, or Ollama configuration.
It passes `OLLAMA_*` only to a standalone process it starts. An incompatible
macOS app is gracefully quit and replaced with that standalone child, without
reconfiguring or relaunching the app. Other incompatible services remain
untouched and must be stopped for a standalone olc session or configured
manually. See the [operator guide](https://github.com/Shishir435/ollama-client/tree/main/packages/olc#native-ollama)
for platform behavior and configuration.

The following API documentation applies to **Codex/OpenCode proxy modes**. Codex defaults to `http://127.0.0.1:8083`; OpenCode defaults to `http://127.0.0.1:8084`. Configure Ollama Client with a custom OpenAI-compatible provider using the matching `/v1` base URL, then select a model returned by the catalog. The examples below use the Codex default; substitute port `8084` for OpenCode.

Use `pnpm proxy:opencode:debug` or `pnpm proxy:codex:debug` for verbose proxy
logging in the foreground. The existing `pnpm proxy` and `pnpm proxy:debug` commands remain
OpenCode aliases.

The CLI is distributed as release archives, not through npm, PyPI, or Homebrew.
Do not tell users to install an `olc` package from a public registry.

## Authentication and browser access

Pass `--api-key` or set `OLC_API_KEY`; API routes then require `Authorization: Bearer <token>`. Health routes stay unauthenticated. The proxy binds to `127.0.0.1` by default—keep that loopback default unless you have a specific network design and authentication in place.

Browser origins are checked separately. The defaults allow Chrome, Firefox, and Safari extension schemes. Add a web application's exact origin with `--allowed-origins http://localhost:3000`. Avoid `--allowed-origins "*"`, especially without an API key, because the proxy can run an agent and spend inference.

## Endpoints

| Method and path | operationId | Purpose |
| --- | --- | --- |
| `GET /` | `getServiceInfo` | Identify olc, the active backend, and tool-bridge state. |
| `GET /health` | `getHealth` | Check process liveness. |
| `GET /v1/models` | `listModels` | List backend models and capability metadata. |
| `GET /v1/models/{modelId}` | `getModel` | Read one model by full or unambiguous suffix id. |
| `POST /v1/chat/completions` | `createChatCompletion` | Generate a buffered JSON completion or an SSE stream. |
| `POST /v1/images/generations` | `createImageGeneration` | Generate one image through a capable backend. |

`POST /bridge/call` is an internal, per-run callback used by the OpenCode adapter. It is not a public integration endpoint and is intentionally excluded from the public OpenAPI surface.

## Minimal request

```bash
curl http://127.0.0.1:8083/v1/chat/completions \
  -H 'Authorization: Bearer replace-with-a-long-random-token' \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "provider/model",
    "messages": [{"role": "user", "content": "Explain this repository"}],
    "stream": false
  }'
```

Discover model ids through `GET /v1/models`; do not invent one. Model rows also report input modalities, supported parameters, and function-calling, vision, and reasoning capabilities.

## Image generation

When the active Codex provider reports native image generation, olc publishes a dedicated `codex/image-generation` model with `"image"` in `output_modalities`. Generate one image with the standard Images request:

```bash
curl http://127.0.0.1:8083/v1/images/generations \
  -H 'Authorization: Bearer replace-with-a-long-random-token' \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "codex/image-generation",
    "prompt": "A watercolor fox reading beside a window",
    "response_format": "b64_json"
  }'
```

The current contract produces one base64 image (`n=1`). A backend that does not advertise native image output returns `501`; olc never invents image capability from a model name.

## Function calling

Send OpenAI-shaped `tools` with unique function names, descriptions, and JSON Schema parameters. If the runtime calls a client tool, olc returns a completion with `finish_reason: "tool_calls"`. Execute the requested tools, append assistant and `tool` messages with the matching `tool_call_id` values, and send the conversation back to the same endpoint. The proxy resumes the parked turn.

Tool results belong to one live turn. An expired, cancelled, or foreign id returns `400` with type `StaleToolResults` and code `stale_tool_results`; remove those stale results and begin a new turn only after making that reset visible to the user.

## JSON errors

Non-streaming errors use an OpenAI-style JSON envelope:

```json
{
  "error": {
    "type": "BadRequest",
    "code": "optional_machine_code",
    "message": "Human-readable explanation and recovery hint"
  }
}
```

Common statuses are `400` for malformed requests or stale tool results, `401` for an invalid bearer token, `403` for a disallowed browser origin, `404` for an unknown route or model, `502` for a backend failure, `503` for a stalled request queue, and `504` for a timeout. A stream that fails after headers were sent reports a final proxy-error text delta because the HTTP status can no longer change.

## Versioning, rate limits, and deprecation

The local proxy's public API is versioned in its URL under `/v1`. Clients should
use the documented versioned routes and inspect `X-API-Version` in responses.
The proxy publishes the RFC RateLimit fields (`RateLimit-Policy`, `RateLimit`,
`RateLimit-Limit`, `RateLimit-Remaining`, and `RateLimit-Reset`) on API
responses. When a client exceeds the configured window it receives `429` with
`Retry-After`; retry with exponential backoff and do not blindly replay a
non-idempotent generation.

No `/v1` route is removed without advance notice. A future deprecated route
will return the standard `Deprecation` response header and a `Sunset` HTTP date
at least 30 days before removal. The migration and replacement route will be
documented here and in the OpenAPI specification. The website's read-only
discovery surface is available at [`/api`](/api) and uses the same header
conventions.

## Agent integration guidance

Use olc when the caller already supports OpenAI chat completions and needs a local agent runtime, particularly when the caller—not the runtime—owns tool execution and approval. Inspect `/v1/models` before choosing modalities or tools. Prefer non-streaming responses when a simple function runner cannot parse server-sent events.

Do not use this interface as a substitute for the extension's internal RPC contracts, do not call the bridge endpoint, and do not send requests to `ollamaclient.in/v1`. For extension architecture and contribution boundaries, use the [architecture guide](/concepts/architecture/) and the generated [TypeScript reference](/reference/).

## Resources

- [OpenAPI 3.1 JSON](/openapi.json)
- [olc source and full operator guide](https://github.com/Shishir435/ollama-client/tree/main/packages/olc)
- [Provider setup](/guides/provider-setup/)
- [Error reports](/guides/troubleshooting/error-reports/)
- [GitHub issues](https://github.com/Shishir435/ollama-client/issues)

There is no hosted sandbox or API-key dashboard because the API runs on the user's machine. Use a disposable local checkout and a non-sensitive model for integration tests.
