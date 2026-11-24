import {
  reportedContextLengthFromModelInfo,
  resolveEffectiveContext
} from "@/lib/model-context"
import { resolveProviderBaseUrl } from "./base-url"
import type { LLMProvider } from "./types"

const REPORTED_TTL_MS = 60_000

const reportedCache = new Map<
  string,
  { value: number | undefined; expiresAt: number }
>()

export const clearReportedContextCache = () => reportedCache.clear()

/**
 * The window a provider says a model holds, from its model details. Only a
 * provider that answers details can say; the rest report nothing. A failed
 * lookup is not cached and reads as "unknown", never as an error: nothing
 * about asking for a window should stop a request.
 */
export const getReportedContextLength = async (
  provider: LLMProvider,
  model: string,
  signal?: AbortSignal
): Promise<number | undefined> => {
  if (!provider.capabilities?.modelDetails || !provider.getModelDetails) {
    return undefined
  }
  const key = `${provider.id}::${
    provider.config.type === "browser"
      ? ""
      : resolveProviderBaseUrl(provider.config)
  }::${model}`
  const cached = reportedCache.get(key)
  if (cached && cached.expiresAt > Date.now()) return cached.value
  try {
    const details = await provider.getModelDetails(model, signal)
    const value = reportedContextLengthFromModelInfo(details?.model_info)
    reportedCache.set(key, { value, expiresAt: Date.now() + REPORTED_TTL_MS })
    return value
  } catch {
    return undefined
  }
}

/**
 * The `num_ctx` to send for a model. Every request to the same model must
 * agree on it: Ollama reloads a model whose options changed, so a query
 * reformulation or warmup that asked for a different window than the chat
 * would evict the model the chat then has to load again.
 *
 * `hint` is a window learned elsewhere — a catalog, a user override — used when
 * the provider's own details say nothing.
 */
export const resolveProviderNumCtx = async (
  provider: LLMProvider,
  model: string,
  configured: number | undefined,
  options: { signal?: AbortSignal; hint?: number } = {}
): Promise<number> =>
  resolveEffectiveContext({
    configured,
    reported:
      (await getReportedContextLength(provider, model, options.signal)) ??
      options.hint
  })
