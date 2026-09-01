# olc

One CLI for native Ollama and local agent proxies. With no arguments, `olc`
starts or reuses **native Ollama** with browser-extension access. Ollama keeps its
own API and default port; it does not run behind the agent proxy.

| Command | Behavior | Default bind |
| --- | --- | --- |
| `olc` | Start or reuse native Ollama | `127.0.0.1:11434` |
| `olc --lan` | Enable LAN access; restart when needed | `0.0.0.0:11434` |
| `olc -b codex` | Start the Codex proxy | `127.0.0.1:8083` |
| `olc -b opencode` | Start the OpenCode proxy | `127.0.0.1:8084` |

`-b` and `--backend` are aliases. `--backend=codex` also works.

**Migration:** bare `olc` previously selected OpenCode. Update scripts to
`olc -b opencode --foreground` to keep that behavior. An explicit `OLC_BACKEND` or config
`BACKEND` still takes precedence over the new default. These defaults ship with
the next release; older installed bundles keep their previous behavior.

In either explicit agent mode, olc is an OpenAI-compatible HTTP front end for a local agent runtime, with a **tool
bridge** so an OpenAI-compatible client can run its own tools inside the
runtime's turn. Bundled backends serve [OpenCode](https://opencode.ai) and the
official [Codex CLI](https://developers.openai.com/codex/cli).

Any client that already speaks `/v1/chat/completions` — Ollama Client's
OpenAI-compatible provider, an SDK, `curl` — can use those models, tool calling
included, without knowing what is behind the proxy.

```
client  ──  POST /v1/chat/completions (messages + tools)  ──▶  olc  ──▶  backend turn
        ◀──  tool_calls delta, finish_reason=tool_calls    ──         (turn parked)
        ──  POST /v1/chat/completions (… + tool results)   ──▶  olc  ──▶  same turn resumed
        ◀──  content deltas, finish_reason=stop            ──
```

## Short aliases

| Scope | Aliases |
| --- | --- |
| Shared | `-b` backend, `-H` host, `-p` port, `-o` origins, `-c` config, `-D` detached, `-f` foreground, `-d` debug, `-h` help |
| Ollama | `-l` LAN, `-L` local, `-O` binary, `-k` check, `-j` JSON |
| Proxy | `-K` API key, `-s` system prompt, `-n` no bridge |
| OpenCode | `-u` URL, `-x` binary, `-a` agent, `-P` project, `-t` allowed tools, `-g` plugin directory |
| Codex | `-C` binary, `-W` workspace, `-w` web-search mode |

Short flags take separate values (`-p 8083`); long flags also accept
`--name=value`. Short flags are case-sensitive and are not combined into clusters.

## Background and foreground mode

All three backends default to **detached** mode. `--debug` keeps the command
in the **foreground** with diagnostic output; `--foreground` does the same
without enabling verbose logging. `--detached` explicitly selects the default.
Contradictory `--foreground --detached` or `--debug --detached` combinations fail.

```bash
olc                          # native Ollama, background
olc --lan                    # configure LAN, background
olc --debug                  # attached native diagnostics
olc -b codex                 # detached Codex proxy
olc -b opencode --detached    # detached OpenCode proxy
olc -b codex --foreground     # attached proxy, normal logs
olc -b opencode --debug       # attached proxy, verbose logs
```

- A detached proxy prints its URL, PID, log path, and stop instruction after
  both its HTTP listener and backend are ready. Logs are private per-run files
  under `~/.olc/logs/`; `OLC_LOG_DIR` overrides that directory. Startup failure
  returns a nonzero exit code and names the log. An occupied port is an error;
  olc never stops an existing proxy to replace it.
- Proxy configuration is handed to the child over private IPC, not written to
  disk or duplicated in child arguments. Parent loss before accepting startup
  shuts down the new child. After handoff, closing the terminal leaves it running.
- Foreground proxies stop on Ctrl-C. A standalone Ollama started in foreground
  streams its server logs to stderr, enables `OLLAMA_DEBUG` with `--debug`, and
  stops with its CLI session. Its exit code is propagated.
- Already-running Ollama and app/service-managed Ollama remain with their owner.
  Foreground mode stays attached as a readiness monitor, with diagnostics on
  stderr; Ctrl-C exits only the monitor. Server logs remain with the app/service.
  `--check` always returns immediately after its read-only check, even with debug.
- `OLC_DETACHED=false` or JSON config `"DETACHED": false` selects foreground by
  default. CLI flags override that setting; debug logging always requires
  foreground mode, including debug enabled through config/environment.

Detached proxies are background processes, not installed login/reboot services.
For a process supervisor or container, use `--foreground`. On Unix, stop the
reported detached proxy with `kill -TERM <pid>` so its backend can clean up.
On Windows, prefer foreground for terminal-controlled shutdown; stopping a
background process through Task Manager does not guarantee graceful cleanup.

## Why a bridge

An agent runtime like OpenCode runs its own loop with its own tools; it does not
forward a caller's tool definitions to the model. The bridge closes that gap:

1. The tools of a request are handed to the backend, which makes its runtime able
   to call them — for OpenCode, by generating a plugin and reloading it.
2. When the model calls one, the backend hands it to the core, which **parks** the
   call and interrupts the stream with an OpenAI `tool_calls` delta plus a
   `tool_calls` finish reason. The runtime's turn stays alive, blocked on the
   parked call.
3. The client executes the tool and sends its next request. The trailing `tool`
   messages carry the same ids, so that request **resumes the same turn** rather
   than starting a new one.

A browser extension cannot host a server, so the client's next request is the
only channel a tool result can come back through. Correlating on the tool-call id
is what keeps the client a plain OpenAI caller: no proxy-specific endpoints, no
side channel, no client-side special cases.

## Install and run

Requires Node ≥ 22.12 and an existing [Ollama installation](https://ollama.com/download) for native mode. macOS/Linux also need `lsof` for safe listener inspection. The OpenCode backend needs the `opencode` binary on
`PATH` (or `--opencode`). The Codex backend needs the `codex` binary on `PATH`
(or `--codex`) and an existing `codex login`; olc never reads, stores, or proxies
the user's OpenAI credentials.

Nothing is published to a registry. Release bundles can be installed directly:

```powershell
# Windows PowerShell
irm https://ollamaclient.in/olc.ps1 | iex
```

```bash
# macOS / Linux
curl -fsSL https://ollamaclient.in/olc.sh | sh
```

Both installers download a checksum-verified archive from the project's GitHub
release. Set `OLC_VERSION` to install a specific tag, or `OLC_INSTALL_DIR` to
change the destination. Node remains an explicit prerequisite; olc itself and
its runtime dependency are bundled, so npm is not involved.

To run from a clone instead:

```bash
pnpm install
pnpm proxy:bundle          # one minified file: packages/olc/dist/olc.mjs
packages/olc/bin/olc       # start/reuse native Ollama
packages/olc/bin/olc -b opencode --port 9000 --debug
```

`bin/olc` is a POSIX shell launcher. It runs the bundle when one exists, falls
back to the compiled output, and finally to the TypeScript sources through `tsx`,
so it works in a fresh checkout either way. On Windows, run
`node packages/olc/dist/olc.mjs` directly.

Other entry points, from the repository root:

```bash
pnpm olc                   # native Ollama from source
pnpm proxy:opencode        # run OpenCode from source
pnpm proxy:opencode:debug  # run OpenCode with verbose logging
pnpm proxy:codex           # run Codex from source
pnpm proxy:codex:debug     # run Codex with verbose logging
pnpm proxy                 # compatibility alias for OpenCode
pnpm proxy:debug           # compatibility alias for verbose OpenCode
pnpm proxy:build           # per-file build with type declarations, for embedding
```

The bundle inlines the one runtime dependency, so `dist/olc.mjs` plus the plugin
directory beside it is everything the proxy needs — no `node_modules` at run
time. Publishing to npm later needs no changes: `package.json` already points
`bin` and `exports` at the compiled output.

If nothing is listening on the configured OpenCode URL, olc starts one itself in
a temporary workspace and stops it on exit.

To serve Codex instead:

```bash
codex login
olc --backend codex
```

The adapter starts `codex app-server` over stdio, creates ephemeral read-only
threads, and maps its streamed messages, reasoning, model catalog, and dynamic
tool calls onto the same OpenAI-compatible API. Codex account entitlements and
usage limits still apply.

### Versioning

olc ships with Ollama Client and carries the same version number; a contract test
(`config/__tests__/package-versions.test.ts`) fails if the two drift.

### Use it from Ollama Client

For native mode, select the built-in **Ollama** provider at
`http://127.0.0.1:11434`. For Codex/OpenCode, add a **custom OpenAI-compatible provider** with base URL
`http://127.0.0.1:8083/v1` for Codex or `http://127.0.0.1:8084/v1` for OpenCode, then pick a model from the list. Tool calling, vision
and reasoning are advertised per model from the backend's own metadata, so the
client enables them the same way it does for any other provider — no overrides.

Reasoning effort follows OpenCode's model variants. `GET /v1/models` reports
only the canonical levels that the selected OpenCode model actually exposes.
The proxy merges OpenCode's v2 model list with its legacy provider metadata,
because some OpenCode releases omit variants from `/api/model` while still
reporting them through `/config/providers`.
`POST /v1/chat/completions` accepts either `reasoning_effort` or
`reasoning.effort`; an explicit level is forwarded as OpenCode's `variant`.
Omitting it (or sending `auto`) leaves the variant unset so OpenCode chooses its
default. A level the model does not report is rejected with `400` rather than
silently changed to a nearby level.

## Options

Command line wins, then the environment, then `config.json`, then the default.

### Native Ollama

- `--lan` switches to `0.0.0.0`; `--local` restores `127.0.0.1`. Existing LAN
  access is preserved by plain `olc`. Explicit `--host` and `--port` override defaults.
- Native configuration uses `OLLAMA_HOST` (`host:port`) and `OLLAMA_ORIGINS` from
  the environment or JSON config. Generic file `PORT`/`BIND_HOST` and proxy
  `OLC_PORT`/`OLC_BIND_HOST` are ignored in native mode, so old proxy settings
  cannot move Ollama to port 8083. `--ollama` / `OLC_OLLAMA_PATH` selects a binary.
- Extension origins are merged with configured origins, including
  `--allowed-origins`, `OLC_ALLOWED_ORIGINS`, and the running server's origins
  when restarting. Other Ollama environment settings are preserved.
- `olc --check` is read-only. `olc --check --json` emits one JSON result on
  stdout; diagnostics go to stderr. Combine `--check --lan` to require LAN bind.
  Exit codes are `0` ready/help, `1` not ready/runtime error, `2` usage/config error.
- **No native authentication:** `--api-key` and proxy API-key configuration are
  rejected in native mode. LAN access is for trusted networks only; a firewall
  is still needed. Restarts interrupt active generations.

On macOS, olc restarts the Ollama app through its normal quit/open lifecycle and
sets its environment with `launchctl` (until logout). Standalone Unix processes
are identified before `SIGTERM`; olc never escalates to a force-kill. Servers
started directly by olc in detached mode keep running after it exits and log to
`~/.ollama/olc.log`; foreground servers stay attached and stop with the session.

On Linux, an existing systemd unit is kept under systemd. User services and
root-run system services use a dedicated `99-olc.conf` drop-in. If a system
service needs administrator access, olc prints the configuration/restart steps
and leaves it alone; it never invokes sudo. If a service is stopped, start it
through systemd first so olc can read and preserve its effective settings.
Remove that drop-in and reload
systemd to undo its persistent configuration.

On Windows, a stopped standalone server can be launched and a ready server reused.
Automatic restarts of existing Windows processes are refused: quit the tray app
(or stop `ollama serve`), export the desired `OLLAMA_*` settings, then rerun olc.
This avoids force-killing the tray app or losing settings that Windows cannot
expose safely. `--check` remains read-only on every platform.

The older `tools/setup/ollama-env.sh` remains available only for existing scripts.
New setups should install olc with `curl -fsSL https://ollamaclient.in/olc.sh | sh`
(macOS/Linux) or `irm https://ollamaclient.in/olc.ps1 | iex` (PowerShell), then
use `olc`, `olc --lan`, or `olc --check --json`. The same installer serves all modes; Ollama itself is installed separately.

### Proxy core (`-b codex` / `-b opencode`)

| Option | Flag | Environment | Default |
| --- | --- | --- | --- |
| `PORT` | `--port`, `-p` | `OLC_PORT` | Codex: `8083`; OpenCode: `8084` |
| `BIND_HOST` | `--host` | `OLC_BIND_HOST` | `127.0.0.1` |
| `API_KEY` | `--api-key` | `OLC_API_KEY` | none (no auth) |
| `ALLOWED_ORIGINS` | `--allowed-origins` | `OLC_ALLOWED_ORIGINS` | the extension schemes |
| `BACKEND` | `--backend`, `-b` | `OLC_BACKEND` | CLI: `ollama`; embedded proxy: `opencode` |
| `SYSTEM_PROMPT` | `--system-prompt` | `OLC_SYSTEM_PROMPT` | the client's |
| `BRIDGE_ENABLED` | `--no-bridge` to disable | `OLC_BRIDGE_ENABLED` | `true` |
| `DEBUG` | `--debug` | `OLC_DEBUG` | `false` |

`REQUEST_TIMEOUT_MS`, `BRIDGE_CALL_TIMEOUT_MS`, `BRIDGE_BATCH_MS` and
`SUSPENDED_TURN_TTL_MS` follow the same precedence with `OLC_`-prefixed
environment variables.

#### Who may call it

The proxy listens on loopback and runs an agent, so a page in the user's browser
must not be able to drive it. A request carrying a browser `Origin` is refused
with `403` unless that origin is allowed; a request with no `Origin` — a CLI, a
script, an extension's own background fetch — is not affected.

The default allows `chrome-extension://*`, `moz-extension://*` and
`safari-web-extension://*`, which is what the extension this proxy serves sends.
Add a web client explicitly:

```bash
olc --allowed-origins http://localhost:3000
```

`--allowed-origins "*"` restores the old wildcard. Do not combine it with a
missing `API_KEY` unless nothing untrusted can reach the port.

### OpenCode backend

| Option | Flag | Environment | Default |
| --- | --- | --- | --- |
| `OPENCODE_SERVER_URL` | `--opencode-url` | `OPENCODE_SERVER_URL` | `http://127.0.0.1:4097` |
| `OPENCODE_PATH` | `--opencode` | `OPENCODE_PATH` | `opencode` |
| `OPENCODE_AGENT` | `--agent` | `OPENCODE_PROXY_AGENT` | OpenCode's default |
| `PROJECT_DIR` | `--project-dir` | `OPENCODE_PROXY_PROJECT_DIR` | temporary workspace |
| `ALLOW_OPENCODE_TOOLS` | `--allow-opencode-tools` | `OPENCODE_PROXY_ALLOW_OPENCODE_TOOLS` | none |
| `PLUGIN_DIR` | `--plugin-dir` | `OPENCODE_PROXY_PLUGIN_DIR` | under the system temp dir |
| `AUTO_APPROVE_PERMISSIONS` | — | `OPENCODE_PROXY_AUTO_APPROVE_PERMISSIONS` | `true` |
| `USE_ISOLATED_HOME` | — | `OPENCODE_USE_ISOLATED_HOME` | `false` |
| `EVENT_FIRST_DELTA_TIMEOUT_MS`, `EVENT_IDLE_TIMEOUT_MS`, `POLL_TIMEOUT_RETRIES` | — | `OPENCODE_PROXY_*` | `6000`, `12000`, `2` |

#### The runtime's own tools are off by default

Every tool id OpenCode reports is explicitly disabled per turn unless listed in
`ALLOW_OPENCODE_TOOLS`. The client that talks to this proxy has its own tool
inventory and its own approval flow; an agent quietly reaching for `bash` or
`write` instead is neither visible nor wanted there. Opt individual tools back in
by id with `--allow-opencode-tools`.

`web_search` is also the client's per-turn search intent. Its execution policy
can request client-managed, automatic, or native-only search. Automatic uses
OpenCode's `websearch` when discovered and otherwise preserves the client tool as
a SearXNG/Brave/Tavily fallback. Native-only removes that fallback and therefore
fails closed when `websearch` is absent. Native `webfetch` remains off unless the
operator explicitly lists it; a web-search request alone does not grant arbitrary
URL fetching. Clients without a policy annotation retain automatic behavior.

### Codex backend

| Option | Flag | Environment | Default |
| --- | --- | --- | --- |
| `CODEX_PATH` | `--codex` | `OLC_CODEX_PATH` (or `CODEX_PATH`) | `codex` |
| `CODEX_PROJECT_DIR` | `--codex-project-dir` | `OLC_CODEX_PROJECT_DIR` | isolated temporary workspace |
| `CODEX_WEB_SEARCH_MODE` | `--codex-web-search` | `OLC_CODEX_WEB_SEARCH_MODE` | `cached` |

Codex runs with `approvalPolicy: never`, a read-only sandbox, and an ephemeral
thread rooted in the dedicated workspace. The client-provided tools are exposed
through App Server dynamic tools; every tool result still returns through the
existing OLC/OpenAI tool-call round trip, so Ollama Client remains the approval
and execution boundary. `--no-bridge` disables those dynamic tools. When App
Server reports native image generation, olc publishes a dedicated
`codex/image-generation` model and exposes its result through the
OpenAI-compatible Images endpoint. Ordinary Codex models remain text-output models;
older Codex builds simply omit the image-generation model.

For ordinary chat turns, an incoming `web_search` function is explicit per-turn
intent. olc removes the duplicate dynamic tool and starts that Codex thread with
search set to the client-requested `cached`, `indexed`, or `live` mode, capped by
`CODEX_WEB_SEARCH_MODE`. A turn without the function—or one explicitly requesting
client-managed execution—always starts with search `disabled`. Automatic mode
preserves the client function as fallback when native search is operator-disabled;
native-only removes it and fails closed. Image turns always disable search.
Codex `webSearch` lifecycle items are forwarded as reasoning-status deltas, while
commentary-phase messages stay in reasoning instead of being concatenated into
the final answer. Debug mode reports the selected native mode and the number of
observed search events, but never logs the query text.

## Endpoints

| Route | Purpose |
| --- | --- |
| `GET /health`, `GET /` | liveness and which backend is serving |
| `GET /v1/models`, `GET /v1/models/:id` | the backend's catalog with capability metadata |
| `POST /v1/chat/completions` | streaming and non-streaming completions, tool calls included |
| `POST /v1/images/generations` | one native generated image as `b64_json` when the backend advertises image output |
| `POST /bridge/call` | registered by the OpenCode backend; loopback-only, requires the per-run bridge token |

## Layout

The core is runtime-agnostic; everything OpenCode-specific lives in its backend.

| Path | Owns |
| --- | --- |
| `src/cli.ts` | flags, config file, signals |
| `src/proxy.ts` | composition: config, registry, server, routes |
| `src/config.ts` | core option precedence, plus the helpers backends resolve their own with |
| `src/core/http.ts` | the small `node:http` router, JSON bodies, SSE headers |
| `src/core/chat-route.ts` | the chat turn lifecycle: streaming, hand-off, resume |
| `src/core/pending-tool-calls.ts` | parked calls, correlation ids, deadlines |
| `src/core/client-tools.ts` | the `callClientTool` port handed to a backend |
| `src/core/openai-wire.ts` | OpenAI ⇄ prompt translation and chunk shapes |
| `src/core/models-route.ts` | `/v1/models` over whatever the backend reports |
| `src/core/image-route.ts` | validated OpenAI-compatible image generations |
| `src/backends/types.ts` | the backend port and its contract |
| `src/backends/registry.ts` | name → backend factory |
| `src/backends/opencode/` | the OpenCode adapter: server supervision, catalog, plugin manifest, turn reading |
| `src/backends/opencode/plugin/` | the plugin OpenCode loads; TypeScript, copied at run time and executed by OpenCode's runtime |
| `src/backends/codex/` | the Codex App Server process, JSONL protocol, model and dynamic-tool mappings |

## Adding a backend

Implement `AgentBackend` from `src/backends/types.ts` and add it to
`src/backends/registry.ts`. Nothing in `src/core/` changes, and
`--backend <name>` selects it.

```ts
export const createMyBackend: BackendFactory = (context) => ({
  id: "my-backend",
  ensureReady: async () => {},
  listModels: async () => [...],                 // CatalogModel[], capabilities included
  resolveModel: async (requested) => ({ providerId: "x", modelId: "y" }),
  startTurn: async (input) => new MyTurn(input),  // must not block until the turn ends
  findTurn: (id) => turns.get(id),
  registerRoutes: (router) => { /* only if the runtime calls back */ },
  shutdown: async () => {}
})
```

What the core guarantees, so a backend never re-implements it:

- **Tool calls.** Call `context.callClientTool({ turnId, tool, args })` and await
  the client's output. The core parks the call, announces it as an OpenAI
  `tool_calls` delta, and resolves your promise from the client's next request.
- **Suspension.** `run`/`resume` receive `signals.suspended`; resolve
  `{ status: "suspended" }` when it settles and the core hands that leg to the
  client. In `resume`, call `signals.releaseToolResults()` once you are ready for
  continued output.
- **Configuration.** Resolve your own settings from `context.options`,
  `context.fileOptions` and the environment with the helpers in `src/config.ts`,
  as `src/backends/opencode/config.ts` does. The core's `ProxyConfig` stays
  generic.

The core is covered by tests that drive it through a fake backend
(`src/core/__tests__/chat-route.test.ts`), which is the quickest way to check a
new adapter's expectations.

## Known limits

- **One turn at a time.** Requests are serialized, because a single OpenCode
  instance runs one agent loop. A request that outlives `REQUEST_TIMEOUT_MS` is
  cancelled, not merely failed, and the next request waits for it to unwind. A
  cancelled turn that does not stop is never overtaken: after ten seconds the
  queue refuses requests with `503` and names it, until it stops.
- **A turn per user message.** Conversation history is replayed from the client's
  messages; only a tool exchange reuses its turn. Trailing tool results whose turn
  the proxy no longer holds — expired, cancelled, or from an earlier run — are
  refused with `400 StaleToolResults` rather than folded into a new turn. A turn
  whose resume request is queued is not reaped while it waits, and the
  correlation is re-checked inside the queue slot.
- **Images ride along as file parts.** `image_url` and `input_image` content parts
  become OpenCode file parts, data URL and all, so a vision model sees them. What
  the model does with them is the model's business: a text-only model is sent the
  attachment and ignores it.
- **The OpenCode plugin needs OpenCode's plugin runtime.** olc links it next to
  the generated plugin; if it cannot be found, tools are dropped from the request
  and a warning names them. Point `OPENCODE_PLUGIN_RUNTIME_DIR` at the
  `node_modules` directory containing `@opencode-ai/plugin` to fix it.

## Tests

```bash
pnpm vitest run --project packages packages/olc
```

## Build outputs

| Command | Output |
| --- | --- |
| `pnpm proxy:bundle` | `dist/olc.mjs`, one minified ES module, plus `dist/backends/opencode/plugin/` |
| `pnpm proxy:build` | per-file `dist/**/*.js` with `.d.ts` declarations, for embedding the proxy in another program |

Both leave the bridge plugin as loose TypeScript files, because OpenCode's own
runtime loads and executes them.
