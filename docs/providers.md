# Providers

This project uses a provider abstraction layer so chat generation can route to different local model backends while keeping a single UI.

## 1) Current Provider Matrix (v0.6.0)

| Provider | Chat Stream | Model Discovery | Model Details | Pull/Delete/Unload | Embeddings |
|---|---:|---:|---:|---:|---:|
| Ollama | Yes | Yes | Yes | Yes | Yes |
| LM Studio | Yes | Yes | Limited | No | Conditional (`/v1/embeddings`) |
| llama.cpp server | Yes | Yes | Limited | No | Conditional (`/embedding` and `/v1/embeddings`) |

Notes:

- Multi-provider routing is active for chat generation.
- Model management operations in background handlers are still mostly Ollama endpoints.
- Embedding generation now uses a non-blocking fallback chain:
  provider-native -> shared model -> background warmup -> Ollama fallback.

## 1.1 Embedding Capability Reference

| Provider | Embedding Supported | How | Limitations |
|---|---|---|---|
| Ollama | Yes | `/api/embed` (current) and `/api/embeddings` (legacy compatibility) | Requires an installed embedding model; defaults remain Ollama-first for reliability |
| LM Studio | Conditional | OpenAI-compatible `/v1/embeddings` when server/model supports embeddings | Depends on loaded model/runtime; not guaranteed for every setup |
| llama.cpp server | Conditional | Native `/embedding` and OpenAI-compatible `/v1/embeddings` | Server must be started with `--embeddings`; pooling cannot be `none` |

Primary references:

- Ollama API docs: [Embedding endpoint overview](https://ollama.com/blog/embedding-models), [API specification](https://github.com/ollama/ollama/blob/main/docs/api.md)
- LM Studio docs (OpenAI compatibility): [LM Studio REST API](https://lmstudio.ai/docs/app/api/endpoints/openai)
- llama.cpp server docs: [examples/server/README.md](https://raw.githubusercontent.com/ggml-org/llama.cpp/master/examples/server/README.md)

## 2) Provider Abstraction Philosophy

Goals:

- Keep UI workflows stable while swapping model backends.
- Route by model identity and provider mapping rather than hardcoding one backend.
- Allow incremental provider support without rewriting chat logic.

Core interfaces are defined in:

- `src/lib/providers/types.ts`
- `src/lib/providers/factory.ts`
- `src/lib/providers/manager.ts`

## 3) Provider Configuration Model

Provider configuration includes:

- `id`, `type`, `name`, `enabled`
- `baseUrl`
- optional `apiKey`
- optional `customModels`

Storage keys:

- `llm_providers_config_v1`
- `model_provider_mappings`

Defaults currently provisioned:

- Ollama (`http://localhost:11434`)
- LM Studio (`http://localhost:1234/v1`)
- llama.cpp (`http://localhost:8000/v1`)

## 4) Provider Routing Behavior

1. UI fetches models from all enabled providers.
2. Extension stores model -> provider mappings.
3. Background resolves provider at stream time using model mapping.
4. If no mapping exists, provider defaults to Ollama.

Implication:

- If multiple providers expose the same model name, mapping order/state matters.

## 5) Ollama (Primary)

Why primary:

- Most complete integration surface in current code.
- Supports chat, model metadata, and embedding endpoints.
- Supports pull/delete/unload/version handlers currently used by model management UX.

## 6) LM Studio

Integration path:

- Implemented as OpenAI-compatible provider specialization.
- Uses provider base URL profile in settings.
- Supports chat streaming and model discovery.

Current limits:

- Management actions (pull/delete/unload) are not implemented in background for LM Studio.

## 7) llama.cpp

Integration path:

- Implemented as OpenAI-compatible provider specialization.
- Uses local server profile endpoint.
- Supports chat streaming and model discovery.

Current limits:

- Model management parity is not yet implemented.

## 8) Adding a New Provider

Minimal implementation checklist:

1. Implement `LLMProvider` in `src/lib/providers/<provider>.ts`.
2. Add provider id/type in `src/lib/providers/types.ts`.
3. Register defaults in `src/lib/providers/manager.ts` (if it should be user-visible by default).
4. Add creation logic in `src/lib/providers/factory.ts`.
5. Validate UI behavior in provider settings and model list grouping.
6. Add tests for:
   - model listing
   - stream parsing
   - error handling

## 9) Design Tradeoffs

- Legacy key names (`ollama-*`) remain for compatibility.
- Chat provider abstraction advanced faster than management abstraction.
- Embeddings favor reliability by keeping Ollama fallback, even when native provider routes fail.

## 10) Provider Roadmap Priorities

1. Extend provider parity for model-management handlers.
2. Reduce naming debt to provider-agnostic key/message names.
3. Improve mapping conflict resolution for duplicate model IDs.
4. Document explicit support tiers (`stable`, `limited`, `experimental`).
