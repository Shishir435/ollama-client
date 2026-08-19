# olc

An OpenAI-compatible HTTP front end for a local agent runtime, with a **tool
bridge** so an OpenAI-compatible client can run its own tools inside the
runtime's turn. The bundled backend serves [OpenCode](https://opencode.ai).

Any client that already speaks `/v1/chat/completions` — Ollama Client's
OpenAI-compatible provider, an SDK, `curl` — can use those models, tool calling
included, without knowing what is behind the proxy.

```
client  ──  POST /v1/chat/completions (messages + tools)  ──▶  olc  ──▶  backend turn
        ◀──  tool_calls delta, finish_reason=tool_calls    ──         (turn parked)
        ──  POST /v1/chat/completions (… + tool results)   ──▶  olc  ──▶  same turn resumed
        ◀──  content deltas, finish_reason=stop            ──
```

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

Requires Node ≥ 22.12. The OpenCode backend also needs the `opencode` binary on
`PATH` (or `--opencode`).

Nothing is published to a registry: clone the repository and run it.

```bash
pnpm install
pnpm proxy:bundle          # one minified file: packages/olc/dist/olc.mjs (~70 KB)
packages/olc/bin/olc       # start it
packages/olc/bin/olc --port 9000 --debug
```

`bin/olc` is a POSIX shell launcher. It runs the bundle when one exists, falls
back to the compiled output, and finally to the TypeScript sources through `tsx`,
so it works in a fresh checkout either way. On Windows, run
`node packages/olc/dist/olc.mjs` directly.

Other entry points, from the repository root:

```bash
pnpm proxy                 # run from source (tsx), no build step
pnpm proxy:debug           # same, verbose
pnpm proxy:build           # per-file build with type declarations, for embedding
```

The bundle inlines the one runtime dependency, so `dist/olc.mjs` plus the plugin
directory beside it is everything the proxy needs — no `node_modules` at run
time. Publishing to npm later needs no changes: `package.json` already points
`bin` and `exports` at the compiled output.

If nothing is listening on the configured OpenCode URL, olc starts one itself in
a temporary workspace and stops it on exit.

### Versioning

olc ships with Ollama Client and carries the same version number; a contract test
(`config/__tests__/package-versions.test.ts`) fails if the two drift.

### Use it from Ollama Client

Add a **custom OpenAI-compatible provider** with base URL
`http://127.0.0.1:8083/v1`, then pick a model from the list. Tool calling, vision
and reasoning are advertised per model from the backend's own metadata, so the
client enables them the same way it does for any other provider — no overrides.

## Options

Command line wins, then the environment, then `config.json`, then the default.

### Core

| Option | Flag | Environment | Default |
| --- | --- | --- | --- |
| `PORT` | `--port` | `OLC_PORT` | `8083` |
| `BIND_HOST` | `--host` | `OLC_BIND_HOST` | `127.0.0.1` |
| `API_KEY` | `--api-key` | `OLC_API_KEY` | none (no auth) |
| `ALLOWED_ORIGINS` | `--allowed-origins` | `OLC_ALLOWED_ORIGINS` | the extension schemes |
| `BACKEND` | `--backend` | `OLC_BACKEND` | `opencode` |
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
by id, for example `--allow-opencode-tools websearch,webfetch`.

## Endpoints

| Route | Purpose |
| --- | --- |
| `GET /health`, `GET /` | liveness and which backend is serving |
| `GET /v1/models`, `GET /v1/models/:id` | the backend's catalog with capability metadata |
| `POST /v1/chat/completions` | streaming and non-streaming completions, tool calls included |
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
| `src/backends/types.ts` | the backend port and its contract |
| `src/backends/registry.ts` | name → backend factory |
| `src/backends/opencode/` | the OpenCode adapter: server supervision, catalog, plugin manifest, turn reading |
| `src/backends/opencode/plugin/` | the plugin OpenCode loads; TypeScript, copied at run time and executed by OpenCode's runtime |

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
- **Text tool results.** A tool that returns images has its text forwarded; the
  images are not attached to the runtime's turn.
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
