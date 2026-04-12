# OLC Server + Autonomous CLI/TUI (v1)

## Overview

`olc` now runs as one local runtime with three interfaces:

- Non-interactive CLI commands (`run`, `models`, `doctor`, `agent run`)
- Optional interactive TUI chat (`chat`)
- Local OpenAI-compatible HTTP gateway server (`serve`)

This v1 focuses on **provider gateway first** with **supervised automation**.

## Architecture

### Shared core package

A new workspace package, `@olc/core`, is the single source of truth for:

- Config loading/persistence
- Provider selection and model-to-provider routing
- Request/response normalization
- Provider capabilities and model operations
- OpenAI-compatible HTTP server wiring
- Supervised autonomous plan/execution scaffolding

Core location:

- `packages/olc-core/src`

### Runtime configuration model

Configuration is file-based and owned by CLI/server runtime (no browser storage dependency):

- Default path: `~/.config/olc/config.json`
- Override via env: `OLC_CONFIG_PATH`
- Schema contains:
  - `defaultProviderId`
  - `providers[]`
  - `modelMappings`

Fallback routing rule is preserved:

- If no model mapping exists, `defaultProviderId` is used (defaults to `ollama`).

### Provider layer

Implemented provider clients:

- `OllamaProvider`
- `LMStudioProvider`
- `LlamaCppProvider`
- generic `OpenAICompatibleProvider`

Factory-based creation maps provider config to provider client behavior.

Capabilities are explicit per provider (`modelPull`, `modelUnload`, `modelDelete`, etc.) and gate CLI operations.

## CLI Contract

Main command surface:

- `olc run -p "<prompt>" -m <model> [--provider <id>]`
- `olc chat -m <model> [--provider <id>]`
- `olc serve [--host 127.0.0.1] [--port 11435]`
- `olc models list [--provider <id>]`
- `olc models pull <model> --provider <id>`
- `olc models unload <model> --provider <id>`
- `olc models delete <model> --provider <id>`
- `olc doctor`
- `olc agent run --task "<task>"`

### Supervised agent mode

`olc agent run` performs:

1. Plan generation
2. Explicit user confirmation prompt
3. Execution with structured operation logs

This is intentionally supervised v1 behavior (not fully autonomous).

## Server API Contract

When running `olc serve`, endpoints are:

- `GET /healthz`
- `GET /v1/models`
- `POST /v1/chat/completions`

### `/healthz`

Returns process metadata + provider reachability summary:

- runtime uptime
- active config path
- provider connectivity/latency/error details

### `/v1/models`

Returns normalized OpenAI-style model list aggregated from enabled providers.

### `/v1/chat/completions`

Supports OpenAI-compatible request body and both modes:

- Non-streaming response (aggregated assistant message)
- Streaming SSE response (`data: ...` chunks + final `data: [DONE]`)

Error mapping strategy:

- `400` for request/config/selection errors
- `502` for upstream provider failures

## Tests and Verification

Implemented tests in `packages/olc-core/src/__tests__`:

- `config.test.ts`: config bootstrap/default creation
- `runtime.test.ts`: routing/mapping resolution behavior
- `server.test.ts`: integration check for `/v1/models` and `/v1/chat/completions` (stream + non-stream)

## Implementation Notes

- Extension runtime remains unchanged in this phase.
- Shared provider logic is reused conceptually but decoupled into Node runtime core.
- TUI stays optional; stable CLI + server are primary shipping targets in v1.
