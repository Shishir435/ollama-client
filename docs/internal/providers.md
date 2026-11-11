# Engineering reference: providers

Start with [AGENTS.md](../../AGENTS.md). Read this reference when changing the subsystem below.

### Providers (`src/lib/providers/`)

| File | Role |
|---|---|
| `types.ts` | `LLMProvider`, `ProviderConfig`, `ProviderType`/`ProviderId` enums |
| `registry.ts` | static metadata for built-in providers |
| `factory.ts` | `ProviderFactory.getProviderForModel()` |
| `manager.ts` | stable provider CRUD/routing facade |
| `provider-config-repository.ts` | locked config recovery, hydration, defaults, legacy URL adoption |
| `provider-mapping-repository.ts` | scoped model mapping migration and CRUD |
| `provider-compat-migration.ts` | removed-beta remapping, sanitization, duplicate retention |
| `selected-model.ts` | active model state |
| `capabilities.ts` | capability detection and per-flag attribution |
| `model-discovery.ts` | the only production path that asks a provider for a catalog |
| `model-lifecycle.ts` | shared lifecycle result normalization and safe provider errors |
| `ollama.ts`, `lm-studio.ts`, `llama-cpp.ts` | verified built-ins |
| `openai-compatible.ts` | custom OpenAI-compatible endpoints |
| `anthropic.ts` | native Claude Messages API |

Legacy vLLM/LocalAI/KoboldCPP subclasses are compatibility-only, not UI profiles. **Default fallback is Ollama** when no explicit model→provider mapping exists.

#### Model discovery

- **A catalog is not a requirement.** A provider's models are whatever `/models` returns *plus* the user's `customModels`, merged either way (`mergeProviderModels`). Never gate a provider, a connection test, or the model menu on a catalog request succeeding.
- All callers — RPC listing, connection tests, background health checks, tool capability resolution, the embedding-model check — go through `model-discovery.ts`. `discoverProviderModels(provider)` keys on the config it reads off that provider, so an answer cannot be filed against the wrong endpoint.
- A failure is **returned as `catalog: "failed"`, never thrown**: a missing catalog is normal for the model menu and disqualifying for a connection test.
- `architecture-boundaries.test.ts` fails on any `.getModels(` outside `model-discovery.ts`. The single exemption is `super.getModels`, a subclass delegating to its base wire format.
- 404/405/501 is remembered device-local in `model-catalog-support.ts`, fingerprinted by wire + base URL + service profile, expiring after a day. No answer, 401, 429 and 5xx are **never** recorded — they say nothing about whether the endpoint exists.
- The default provider's embedding check keeps its direct `/api/tags` fetch: it skips provider resolution, and remembered absence exists to spare metered remote endpoints, not the user's loopback Ollama. Do not copy that shape for a configured remote provider.
- **A missing catalog never proves reachability** — a mistyped base URL answers identically. An explicit (`draft`) test confirms a catalog-less provider by streaming one token from `/chat/completions`; a missing chat route is reported as a base-URL problem and clears the recorded answer. The background (`stored`) check never sends that request: it is a health poll, not a licence to spend inference.

#### Capability detection

- Resolution order, highest first: user override → empirical probe (`capability-probe.ts`) → model metadata → provider default. An unknown capability resolves to `false`; only an override may flip it on. Never enable vision or tool calling on a guess.
- Metadata evidence, strongest first: Ollama `/api/show` `capabilities[]` → LM Studio `capabilities[]` (for the flags it names) → OpenRouter-style `modalities`/`supported_parameters` → LM Studio `type` (a category, not a statement about the model) → provider default.
- An **empty** metadata array means "unknown", never a reported no; empty catalog arrays are placeholders often enough that treating them as negatives disables working models.
- A new metadata source updates both `getModelCapabilities` and `getModelCapabilityStates`. The second drives the capability sheet's attribution and must not contradict the first.
- **Model lifecycle wires stay in provider adapters.** `LLMProvider.modelLifecycle` is an optional port for loaded-model listing, unload and warmup. `ModelRpcService` owns RPC policy and warmup cooldowns but never builds vendor URLs or branches on provider ids. A capability flag and its operation must agree; a provider without the operation returns unsupported rather than receiving an Ollama-shaped request.

#### Model list metadata

Differs sharply by server, so check before assuming a field exists.

- **Ollama** `/api/tags` omits `family`, `parameter_size` and `quantization_level` for non-GGUF (safetensors/MLX) models. `getModels` backfills from `/api/show` only for models whose format is reported, non-GGUF and sizeless; capped fan-out, and a failed lookup leaves the model as-is.
- **LM Studio** reports no size on any endpoint. `parameterSizeFromModelId` reads it from the id by convention and refuses when the id is ambiguous. Never put `max_context_length` in `parameter_size` — that shipped once and rendered a token window as a model size.
- **llama.cpp** reports `meta.n_params`, already formatted to one decimal.
- `formatParameterSize` normalizes whatever arrives, so one list cannot mix `8B`, `8.2B` and `999.89M`.

#### Vendor marks and favicons

- **Vendor marks are display-only.** `provider-brand.ts` resolves a `ProviderBrandId` from built-in id, then base-URL host, then service profile, then display name; `mergeProviderModels` stamps it on every model row as `providerBrand`. Host beats profile, or every OpenAI-compatible provider would wear OpenAI's mark. An unrecognized provider gets no brand and falls back to the registry glyph. Never guess one, and never derive routing or capabilities from it.
- **A model id may name its own vendor, and that beats the provider's mark on
  a model row.** `resolveModelBrand` reads the segment before the first slash
  against a closed table — an OpenRouter-style `anthropic/claude-3`, an olc
  proxy's `codex/gpt-5.6-luna` — which is the catalog's own word for where the
  model comes from rather than an inference from one, and is what separates
  reading it from guessing. It is display-only like every other mark. Across
  providers the provider's mark is what tells two same-named models apart and
  still takes the slot; inside one provider that mark is identical on every
  row and says nothing, which is how five models under one heading came to
  wear five identical generic glyphs while each id had named its vendor in
  plain text above them. A segment with no mark of its own — `opencode`, a
  user's own namespace — resolves to nothing and keeps the generic icon.
- Marks are inline monochrome SVG in `src/components/icons/provider-brand-icons.tsx` (from MIT-licensed `@lobehub/icons`), rendered through `<ProviderIcon>`, not imported directly.
- **Initials sit between a favicon and the generic glyph.** A custom provider
  with no curated mark and no reachable favicon — which is every loopback
  proxy, since those hosts are refused — drew the same server icon as every
  other one, so a rail holding three said only that three existed.
  `providerMonogram` takes the first letter of a one-word name and two for a
  longer one, drawn as SVG text in the mark's own 24-square box so it scales
  with the size class like a curated mark would. It is offered only for a
  `custom:` id: a built-in with a real icon must never be reduced to a letter.
- **Favicons are the tier below**, for unrecognized *remote* providers only (`provider-favicon.ts`, served by `providers.icons`). Rules, all load-bearing:
  - The configured base URL is asked first. The vendor's site — its registrable domain, then that domain's `www.` host — is asked **only** after a settled "nothing here" (401/403/404/410, a refused redirect, or a 200 carrying non-image bytes — a gateway guards `/favicon.ico` behind its key like every other path), each candidate after the one before it. Timeouts and 5xx are never chased.
  - The walk goes straight to the registrable domain (`integrate.api.nvidia.com` → `nvidia.com`), never down to a public suffix — ccTLD registries (`com.ar`) and shared hosts (`vercel.app`, `github.io`, `workers.dev`) count as suffixes, so `api.my-router.vercel.app` stops at `my-router.vercel.app`. `www.` is asked directly because vendor sites redirect their bare domain there, and redirects stay refused.
  - No third-party favicon service, ever: that would hand every configured provider URL to whoever runs it.
  - Loopback, private, CGNAT and link-local hosts are refused (`169.254.169.254` is the cloud metadata endpoint, and this fetch reaches what a page cannot), and **redirects are refused, not followed** — the host check vets the address we picked, not the one a 302 would pick for a request holding `<all_urls>`.
  - Responses are sniffed from leading bytes rather than trusted from `Content-Type`, capped at 32KB. Hits and misses are both remembered device-local; nothing is recorded once the caller aborted.
  - The filter reads hostnames, so a public name resolving to a private address still passes, and no extension API closes that (`chrome.dns` is dev-channel only; resolving first is TOCTOU because `fetch` looks up again). What bounds it is that nothing leaves the device: no credentials, non-image bytes discarded, and a provider the user already trusts with their prompts. Do not add a resolve step — the honest mitigation is the off switch, which also drops what was already fetched.

## Provider API reference

- **Ollama** — <https://github.com/ollama/ollama/blob/main/docs/api.md>
  - `/api/tags`: list. Omits family/parameter_size/quantization for non-GGUF models.
  - `/api/show`: full metadata, `capabilities[]`, `model_info` including `general.parameter_count`.
- **LM Studio** — <https://lmstudio.ai/docs/developer/rest/endpoints>
  - `/api/v0/models`: `type`, `publisher`, `arch`, `compatibility_type`, `quantization`, `state`, `max_context_length`, `capabilities[]`. **No size of any kind**, here or on `/api/v0/models/{id}`.
  - `/api/v0/chat/completions`: chat. Standard OpenAI-compatible endpoints also work; `/v1/models` returns only `id`/`object`/`owned_by`.
- **llama.cpp** — <https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md>
  - `/v1/models`: includes `meta` with `size` and `n_params`.
  - macOS model cache: `~/Library/Caches/llama.cpp`. Example: `llama-server -m ~/Library/Caches/llama.cpp/<model>.gguf --port 8000 --host 0.0.0.0`
- **OpenAI** — <https://platform.openai.com/docs/api-reference>
- **Anthropic** — <https://platform.claude.com/docs/en/api/messages/create>
- **vLLM** — <https://docs.vllm.ai/en/latest/serving/openai_compatible_server.html>
- **KoboldCPP** — <https://github.com/LostRuins/koboldcpp/wiki>
- **LocalAI** — <https://localai.io/features/openai-functions/>
- **SearXNG** — <https://docs.searxng.org/dev/search_api.html>
- **Brave Search** — <https://api-dashboard.search.brave.com/app/documentation/web-search/responses>
- **Tavily** — <https://docs.tavily.com/documentation/api-reference/endpoint/search>
- **OpenCode** — <https://opencode.ai/docs/> (server API and plugins; used by `packages/olc`)
