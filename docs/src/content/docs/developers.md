---
title: Ollama Client developer portal
description: Integrate with Ollama Client's local olc OpenAI-compatible proxy, including setup, authentication, endpoints, errors, tools, and its OpenAPI specification.
---

Ollama Client is a browser extension, not a hosted inference service. The website at `ollamaclient.in` publishes documentation and machine-readable resources; it does not accept prompts or expose users' models.

The project does include **olc**, a local command-line proxy that exposes an agent runtime through an OpenAI-compatible HTTP API. Use it when an OpenAI-compatible client needs to reach an OpenCode-backed agent and preserve client-owned function calls. The published [OpenAPI 3.1 specification](/openapi.json) describes this local API and deliberately lists loopback servers.

## Quickstart

olc currently runs from a repository checkout and requires Node.js 22.12 or newer plus OpenCode on `PATH`.

```bash
git clone https://github.com/Shishir435/ollama-client.git
cd ollama-client
pnpm install
pnpm proxy:bundle
packages/olc/bin/olc --api-key "replace-with-a-long-random-token"
```

The default address is `http://127.0.0.1:8083`. Configure Ollama Client with a custom OpenAI-compatible provider whose base URL is `http://127.0.0.1:8083/v1`, then select a model returned by the catalog.

The CLI is part of the source distribution but is not yet published to npm, PyPI, or Homebrew. Do not tell users to install an `olc` package from a public registry unless an official release announcement links it.

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
