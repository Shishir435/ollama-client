import {
  autoContextCap,
  reportedContextLengthFromModelInfo,
  resolveEffectiveContext
} from "@/lib/model-context"
import { resolveProviderBaseUrl } from "./base-url"
import type { LLMProvider } from "./types"

const REPORTED_TTL_MS = 60_000
const LOOKUP_DEADLINE_MS = 3000

/**
 * Runs a metadata lookup a request waits on, giving up after a few seconds: a
 * server that accepts `/api/show` and then stalls must not hold a chat, a
 * warmup or a selection action. A stop or the deadline reads as unknown.
 */
export const withLookupDeadline = async <T>(
  lookup: (signal: AbortSignal) => Promise<T>,
  signal?: AbortSignal
): Promise<T | undefined> => {
  const controller = new AbortController()
  const abort = () => controller.abort()
  const timer = setTimeout(abort, LOOKUP_DEADLINE_MS)
  signal?.addEventListener("abort", abort, { once: true })
  const ended = new Promise<undefined>((resolve) =>
    controller.signal.addEventListener("abort", () => resolve(undefined))
  )
  try {
    return await Promise.race([lookup(controller.signal), ended])
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener("abort", abort)
  }
}

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
  const details = await withLookupDeadline(
    async (lookupSignal) => provider.getModelDetails?.(model, lookupSignal),
    signal
  ).catch(() => undefined)
  if (!details) return undefined
  const value = reportedContextLengthFromModelInfo(details.model_info)
  reportedCache.set(key, { value, expiresAt: Date.now() + REPORTED_TTL_MS })
  return value
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
): Promise<number> => {
  const reported =
    (await getReportedContextLength(provider, model, options.signal)) ??
    options.hint
  return resolveEffectiveContext({
    configured,
    reported,
    cap: autoContextCap(provider.id)
  })
}
