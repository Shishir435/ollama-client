---
title: Provider Capability Matrix
description: Which features each provider supports. Generated from the extension's TypeScript source at build time.
sidebar:
  order: 2
---

This matrix is generated from `src/lib/providers/*.ts` on every `pnpm docs:build`. When a provider class changes a capability flag, the table here updates automatically the next time docs are rebuilt.

:::note
✓ = supported · — = not supported. "Supported" here means the provider class exposes a working implementation; it does not mean the underlying server is necessarily running on your machine.
:::

| Provider | Chat | Embeddings | Model discovery | Model details | Pull | Unload | Delete | Version | Tool calling |
|---|---|---|---|---|---|---|---|---|---|
| **Ollama** | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| **LM Studio** | ✓ | ✓ | ✓ | — | ✓ | ✓ | — | — | — |
| **llama.cpp** | ✓ | ✓ | ✓ | — | — | — | — | — | ✓ |
| **vLLM** | ✓ | ✓ | ✓ | — | — | — | — | — | ✓ |
| **LocalAI** | ✓ | ✓ | ✓ | — | — | — | — | — | ✓ |
| **KoboldCPP** | ✓ | ✓ | ✓ | — | — | — | — | — | ✓ |
| **OpenAI-compatible (generic)** | ✓ | ✓ | ✓ | — | — | — | — | — | — |

## Notes

- **Ollama** — Recommended baseline. Full feature parity including pull / delete / unload.
- **LM Studio** — OpenAI-compatible. Adds pull / unload over the OpenAI base.
- **llama.cpp** — Run with `llama-server`. Tool calling supported on recent llama.cpp.
- **vLLM** — High-throughput OpenAI-compatible inference server.
- **LocalAI** — OpenAI-compatible with multi-backend model orchestration.
- **KoboldCPP** — OpenAI-compatible with KoboldCPP's extended sampler controls.
- **OpenAI-compatible (generic)** — Fallback for any OpenAI-compatible server we don't have a dedicated class for.

## How this table is built

The generator at `tools/generate-provider-matrix.ts` instantiates each provider class with a minimal config and reads its `capabilities: ProviderCapabilities` field. The same field is the runtime source of truth for the extension UI's capability-aware routing (chat menu, model-management actions, etc.), so any divergence here would already be a bug.

If you're adding a new provider, register it in:

1. `src/lib/providers/` (the class itself)
2. `src/lib/providers/factory.ts` (the factory map)
3. `src/lib/providers/manager.ts` (`DEFAULT_PROVIDERS`)
4. `tools/generate-provider-matrix.ts` (this generator's `providers` array)

The first three are mandatory for the runtime; the fourth keeps the docs honest.
