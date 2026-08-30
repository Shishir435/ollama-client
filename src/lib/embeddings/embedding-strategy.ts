import { RpcMethod } from "@ollama-client/contracts/rpc"
import {
  DEFAULT_EMBEDDING_MODEL,
  DEFAULT_PROVIDER_ID,
  DEFAULT_SHARED_EMBEDDING_PROVIDER_ID,
  normalizeEmbeddingModelName
} from "@/lib/constants"
import {
  createAppError,
  getErrorMessage,
  isAbortError,
  isAppError
} from "@/lib/error-utils"
import { logger } from "@/lib/logger"
import { ProviderFactory } from "@/lib/providers/factory"
import { ProviderManager } from "@/lib/providers/manager"
import type { LLMProvider } from "@/lib/providers/types"
import { readSetting } from "@/lib/storage/setting-access"
import { SETTINGS } from "@/lib/storage/settings"
import { extensionRpcClient } from "@/protocol/extension-client"
import { getEmbeddingConfig } from "./config"

export type EmbeddingRoute =
  | "provider-native"
  | "shared-model"
  | "shared-model-warmup"
  | "default-provider-fallback"

export interface EmbeddingStrategyResult {
  embedding: number[]
  model: string
  providerId: string
  route: EmbeddingRoute
  routeFingerprint: string
  attemptedRoutes: EmbeddingRoute[]
}

export interface EmbeddingStrategyCapabilities {
  activeProviderId?: string
  providerNativeAvailable: boolean
  sharedProviderId: string
  sharedModel: string
  sharedProviderAvailable: boolean
  defaultFallbackAvailable: boolean
}

export interface EmbeddingStrategyReadiness {
  ready: boolean
  warmingUp: boolean
  details?: string
}

interface EmbedAttempt {
  providerId: string
  route: EmbeddingRoute
  model: string
  /**
   * Resolved once during planning so the fingerprint can name the endpoint a
   * vector would actually come from, and so `tryEmbed` does not re-resolve the
   * same provider for every chunk of a batch. Null when the provider could not
   * be constructed; the attempt is then skipped exactly as an absent `embed`
   * would skip it.
   */
  provider: LLMProvider | null
  baseUrl?: string
}

/**
 * A resolved embedding route plan plus the identity of the routes it will try.
 *
 * The cache key has to describe where a vector came from, not what the settings
 * asked for: `provider-native` and `default-provider-fallback` produce vectors
 * from different models under identical configuration, and re-pointing a
 * provider's base URL at another server changes the weights behind an unchanged
 * provider id and model name. Resolving the plan once and keying on it means a
 * routing change misses the cache instead of returning the previous route's
 * vector, which is the failure that has no error path — a wrong vector ranks
 * silently.
 */
export interface EmbeddingPlan {
  attempts: EmbedAttempt[]
  sharedAttempt?: EmbedAttempt
  /** Stable identity of the whole ordered route plan. */
  fingerprint: string
  /** Identity of the first route that can currently produce a vector. */
  cacheFingerprint?: string
  maxChars: number
}

/**
 * Bump when route selection or truncation semantics change, so vectors cached
 * by an earlier build are not reused under the new meaning of the same plan.
 */
const STRATEGY_REVISION = "v1"

const WARMUP_COOLDOWN_MS = 5 * 60 * 1000
const warmupThrottle = new Map<string, number>()

/**
 * Normalizes model names for specific providers, handling default aliases.
 * @param _providerId Current provider ID (hooks for future per-provider logic).
 * @param model The raw model name string.
 */
const normalizeModelForProvider = (
  _providerId: string,
  model: string
): string => {
  const normalized = normalizeEmbeddingModelName(model)
  const baseModel = DEFAULT_EMBEDDING_MODEL.split(":")[0]?.toLowerCase()

  if (baseModel && normalized.toLowerCase() === baseModel) {
    return DEFAULT_EMBEDDING_MODEL
  }

  return normalized
}

const getActiveProvider = async (): Promise<LLMProvider | null> => {
  try {
    const selectedModelRef = await readSetting(SETTINGS.SELECTED_MODEL_REF)
    if (selectedModelRef?.modelId) {
      return await ProviderFactory.getProviderForModel(
        selectedModelRef.modelId,
        selectedModelRef.providerId
      )
    }

    const selectedChatModel = await readSetting(SETTINGS.SELECTED_MODEL)

    if (!selectedChatModel) {
      return null
    }

    return await ProviderFactory.getProviderForModel(selectedChatModel)
  } catch (error) {
    logger.debug("Failed to resolve active provider", "EmbeddingStrategy", {
      error
    })
    return null
  }
}

const getStoredEmbeddingModel = async (): Promise<string> => {
  const config = await getEmbeddingConfig()
  const stored = await readSetting(SETTINGS.EMBEDDING_SELECTED_MODEL)
  const configModel = config.sharedEmbeddingModel

  if (
    stored &&
    stored !== DEFAULT_EMBEDDING_MODEL &&
    configModel === DEFAULT_EMBEDDING_MODEL
  ) {
    return normalizeEmbeddingModelName(stored)
  }

  return normalizeEmbeddingModelName(
    configModel || stored || DEFAULT_EMBEDDING_MODEL
  )
}

const isContextLengthError = (error: unknown): boolean => {
  const message = getErrorMessage(error)
  return /context length|input length|too long|max(?:imum)? context/i.test(
    message
  )
}

/**
 * Generates an array of character limits used for recursive truncation.
 * Used when an embedding request fails due to context length limits; the strategy
 * will attempt to re-embed the text at these decreasing character boundaries.
 */
const buildTruncationPlan = (maxChars: number): number[] => {
  const targets = [
    maxChars,
    2048,
    1536,
    1024,
    768,
    512,
    384,
    256,
    192,
    160,
    128,
    96,
    64,
    48,
    32
  ]
  const unique: number[] = []
  for (const value of targets) {
    if (value <= 0) continue
    if (!unique.includes(value)) {
      unique.push(value)
    }
  }
  return unique
}

/**
 * Attempts to generate an embedding using a specific route.
 * Implements exponential back-off via truncation for context length errors.
 */
const tryEmbed = async (
  text: string,
  attempt: EmbedAttempt,
  maxChars: number,
  signal?: AbortSignal
): Promise<EmbeddingStrategyResult | null> => {
  const provider = attempt.provider

  if (!provider?.embed) {
    return null
  }

  const truncationPlan = buildTruncationPlan(maxChars)
  let lastError: unknown

  for (let index = 0; index < truncationPlan.length; index++) {
    const limit = truncationPlan[index]
    const truncatedText =
      text.length > limit ? `${text.slice(0, limit)}...` : text

    signal?.throwIfAborted()

    try {
      const vector = await provider.embed(truncatedText, attempt.model, signal)
      if (!Array.isArray(vector) || vector.length === 0) {
        return null
      }

      return {
        embedding: vector,
        model: attempt.model,
        providerId: provider.id,
        route: attempt.route,
        routeFingerprint: attemptFingerprint(attempt),
        attemptedRoutes: [attempt.route]
      }
    } catch (error) {
      lastError = error
      if (!isContextLengthError(error)) {
        throw error
      }
    }
  }

  if (lastError) {
    throw lastError
  }

  return null
}

const scheduleSharedModelWarmup = async (
  providerId: string,
  model: string
): Promise<void> => {
  // Current runtime can only pull models through default-provider handlers.
  if (providerId !== DEFAULT_PROVIDER_ID) {
    return
  }

  const throttleKey = `${providerId}:${model}`
  const lastAttempt = warmupThrottle.get(throttleKey) ?? 0
  if (Date.now() - lastAttempt < WARMUP_COOLDOWN_MS) {
    return
  }

  warmupThrottle.set(throttleKey, Date.now())

  // Fire-and-forget warmup request so UI remains responsive. Only extension
  // pages can reach the RPC boundary; called from the background itself the
  // request has no listener and rejects, which is the same no-op this was
  // before and is why the failure is logged at debug.
  try {
    void extensionRpcClient
      .call(RpcMethod.EmbeddingsPrepareModel, { providerId, model })
      .catch((error: unknown) => {
        logger.debug(
          "Shared embedding model warmup request failed",
          "EmbeddingStrategy",
          { error, providerId, model }
        )
      })
  } catch (error) {
    logger.debug(
      "Shared embedding model warmup could not be scheduled",
      "EmbeddingStrategy",
      { error, providerId, model }
    )
  }
}

/**
 * Attaches an already-constructed provider, recording the endpoint it points
 * at so the plan fingerprint changes when a provider is re-pointed.
 */
const withProvider = (
  attempt: EmbedAttempt,
  provider: LLMProvider | null
): EmbedAttempt => ({
  ...attempt,
  provider,
  ...(provider?.config.baseUrl ? { baseUrl: provider.config.baseUrl } : {})
})

/**
 * Constructs the attempt's provider. A provider that cannot be constructed —
 * removed, or never configured — leaves the attempt in the plan with a null
 * provider so route order and fingerprint stay stable; `tryEmbed` skips it the
 * same way it skips a provider without `embed`.
 */
const resolveAttemptProvider = async (
  attempt: EmbedAttempt
): Promise<EmbedAttempt> => {
  try {
    return withProvider(
      attempt,
      await ProviderFactory.getProvider(attempt.providerId)
    )
  } catch (error) {
    logger.debug("Failed to resolve embedding provider", "EmbeddingStrategy", {
      error,
      providerId: attempt.providerId,
      route: attempt.route
    })
    return withProvider(attempt, null)
  }
}

/**
 * Identity of an ordered route plan.
 *
 * Every field that can change which weights answer a request is present:
 * route, provider id, model, and endpoint. The whole ordered list is included
 * rather than only the first attempt, because a fallback that becomes reachable
 * changes which route answers without changing the head of the list.
 */
const attemptFingerprint = (attempt: EmbedAttempt): string =>
  [
    STRATEGY_REVISION,
    attempt.route,
    // The provider that answers, not the one that was asked for: a configured
    // id is resolved through mappings and defaults, and it is the resolved
    // endpoint that produced the vector.
    attempt.provider?.id ?? attempt.providerId,
    attempt.model,
    attempt.baseUrl ?? "-",
    attempt.provider?.embed ? "embed" : "no-embed"
  ].join(":")

const planFingerprint = (attempts: EmbedAttempt[]): string =>
  attempts.map(attemptFingerprint).join("|")

/**
 * Resolves the sequence of embedding attempts based on the user's configured strategy.
 * Possible routes include provider-native (LLM's matching model), shared-model
 * (a secondary dedicated embedding provider like Ollama), and default-provider (last-resort).
 */
const buildAttempts = async (
  requestedModel?: string
): Promise<{
  attempts: EmbedAttempt[]
  sharedAttempt?: EmbedAttempt
}> => {
  const config = await getEmbeddingConfig()
  const activeProvider = await getActiveProvider()
  let sharedProviderId =
    config.sharedEmbeddingProviderId || DEFAULT_SHARED_EMBEDDING_PROVIDER_ID
  const sharedModel = config.sharedEmbeddingModel || DEFAULT_EMBEDDING_MODEL
  const storedEmbeddingModel = await getStoredEmbeddingModel()

  if (sharedProviderId === DEFAULT_SHARED_EMBEDDING_PROVIDER_ID) {
    try {
      const mapped = await ProviderManager.getModelMapping(storedEmbeddingModel)
      if (mapped?.providerId) {
        sharedProviderId = mapped.providerId
      }
    } catch (error) {
      if (error instanceof Error) {
        logger.debug(
          "Failed to resolve embedding model provider mapping",
          "EmbeddingStrategy",
          {
            error: error.message,
            model: storedEmbeddingModel
          }
        )
      }
    }
  }

  const providerNativeModel = normalizeModelForProvider(
    activeProvider?.id || DEFAULT_PROVIDER_ID,
    requestedModel ||
      (activeProvider?.id === DEFAULT_PROVIDER_ID
        ? storedEmbeddingModel
        : sharedModel)
  )
  const sharedModelResolved = normalizeModelForProvider(
    sharedProviderId,
    requestedModel || sharedModel
  )
  const defaultProviderFallbackModel = normalizeModelForProvider(
    DEFAULT_PROVIDER_ID,
    requestedModel || storedEmbeddingModel || DEFAULT_EMBEDDING_MODEL
  )

  const baseAttempts: EmbedAttempt[] = []
  const allowProviderNative =
    !!activeProvider?.embed &&
    (activeProvider.id === DEFAULT_PROVIDER_ID ||
      config.embeddingStrategy === "provider-native")
  const providerNativeAttempt = allowProviderNative
    ? withProvider(
        {
          providerId: activeProvider.id,
          route: "provider-native" as const,
          model: providerNativeModel,
          provider: null
        },
        activeProvider
      )
    : undefined
  const sharedAttempt = await resolveAttemptProvider({
    providerId: sharedProviderId,
    route: "shared-model",
    model: sharedModelResolved,
    provider: null
  })
  const defaultProviderAttempt = await resolveAttemptProvider({
    providerId: DEFAULT_PROVIDER_ID,
    route: "default-provider-fallback",
    model: defaultProviderFallbackModel,
    provider: null
  })

  switch (config.embeddingStrategy) {
    case "provider-native":
      if (providerNativeAttempt) {
        baseAttempts.push(providerNativeAttempt)
      }
      baseAttempts.push(defaultProviderAttempt)
      break
    case "shared-model":
      baseAttempts.push(sharedAttempt, defaultProviderAttempt)
      break
    case "default-provider-only":
    case "ollama-only":
      baseAttempts.push(defaultProviderAttempt)
      break
    default:
      if (providerNativeAttempt) {
        baseAttempts.push(providerNativeAttempt)
      }
      baseAttempts.push(sharedAttempt, defaultProviderAttempt)
      break
  }

  return {
    attempts: baseAttempts,
    sharedAttempt
  }
}

/**
 * Resolves the full route plan once.
 *
 * A batch caller resolves this for the whole batch rather than per chunk: the
 * plan reads settings, the model mapping and up to three provider
 * configurations, which is the same work `buildAttempts` did per call before.
 */
export const resolveEmbeddingPlan = async (
  requestedModel?: string
): Promise<EmbeddingPlan> => {
  const config = await getEmbeddingConfig()
  const { attempts, sharedAttempt } = await buildAttempts(requestedModel)
  const primaryAttempt = attempts.find((attempt) => attempt.provider?.embed)

  return {
    attempts,
    sharedAttempt,
    fingerprint: planFingerprint(attempts),
    ...(primaryAttempt
      ? { cacheFingerprint: attemptFingerprint(primaryAttempt) }
      : {}),
    maxChars: Math.max(256, Math.floor(config.chunkSize * 4))
  }
}

export const getEmbeddingCapabilities =
  async (): Promise<EmbeddingStrategyCapabilities> => {
    const activeProvider = await getActiveProvider()
    const config = await getEmbeddingConfig()
    const sharedProviderId =
      config.sharedEmbeddingProviderId || DEFAULT_SHARED_EMBEDDING_PROVIDER_ID
    const sharedModel = config.sharedEmbeddingModel || DEFAULT_EMBEDDING_MODEL

    let sharedProviderAvailable = false
    try {
      const sharedProvider = await ProviderFactory.getProvider(sharedProviderId)
      sharedProviderAvailable = typeof sharedProvider.embed === "function"
    } catch {
      sharedProviderAvailable = false
    }

    return {
      activeProviderId: activeProvider?.id,
      providerNativeAvailable: !!activeProvider?.embed,
      sharedProviderId,
      sharedModel,
      sharedProviderAvailable,
      defaultFallbackAvailable: true
    }
  }

const recordEmbeddingRouteFailure = async ({
  error,
  attempt,
  sharedAttempt,
  attemptedRoutes,
  routeErrors,
  routeFailures
}: {
  error: unknown
  attempt: EmbedAttempt
  sharedAttempt?: EmbedAttempt
  attemptedRoutes: EmbeddingRoute[]
  routeErrors: string[]
  routeFailures: unknown[]
}): Promise<void> => {
  if (isAbortError(error)) throw error

  const errorMessage = getErrorMessage(error)
  routeErrors.push(`${attempt.route}: ${errorMessage}`)
  routeFailures.push(error)
  logger.warn(`Embedding route failed: ${attempt.route}`, "EmbeddingStrategy", {
    providerId: attempt.providerId,
    model: attempt.model,
    error
  })

  if (attempt.route !== "shared-model" || !sharedAttempt) return
  attemptedRoutes.push("shared-model-warmup")
  const config = await getEmbeddingConfig()
  if (!config.warmupEmbeddingsInBackground) return
  void scheduleSharedModelWarmup(sharedAttempt.providerId, sharedAttempt.model)
}

/**
 * Robust embedding generation that tries multiple providers and models based on user preference.
 * Use this as the primary entry point for vectorizing text in the extension.
 * @param text The input string to vectorize.
 * @param requestedModel Optional target model (e.g. if forcing specific document dimension).
 * @throws Error if all configured routes and fallbacks fail.
 */
export const generateEmbeddingWithStrategy = async (
  text: string,
  requestedModel?: string,
  options: { plan?: EmbeddingPlan; signal?: AbortSignal } = {}
): Promise<EmbeddingStrategyResult> => {
  const { attempts, sharedAttempt, maxChars } =
    options.plan ?? (await resolveEmbeddingPlan(requestedModel))
  const attemptedRoutes: EmbeddingRoute[] = []
  const routeErrors: string[] = []
  const routeFailures: unknown[] = []

  for (const attempt of attempts) {
    options.signal?.throwIfAborted()
    attemptedRoutes.push(attempt.route)

    try {
      const result = await tryEmbed(text, attempt, maxChars, options.signal)
      if (result) {
        result.attemptedRoutes = [...attemptedRoutes]
        return result
      }
    } catch (error) {
      await recordEmbeddingRouteFailure({
        error,
        attempt,
        sharedAttempt,
        attemptedRoutes,
        routeErrors,
        routeFailures
      })
    }
  }

  // The aggregate adopts the last route's classification when it had one.
  // Reporting every exhausted plan as a generic retryable provider error told
  // the caller nothing: a missing model, a rejected key and an unreachable host
  // all arrived as the same retryable failure, so the UI offered "try again"
  // for causes retrying cannot fix.
  const lastError = routeFailures[routeFailures.length - 1]
  throw createAppError(
    `All embedding routes failed. Attempted: ${attemptedRoutes.join(" -> ")}. Last error: ${
      routeErrors[routeErrors.length - 1] || "unknown"
    }`,
    {
      kind: isAppError(lastError) ? lastError.kind : "provider",
      retryable: isAppError(lastError) ? lastError.retryable : true,
      ...(isAppError(lastError) && {
        code: lastError.code,
        phase: lastError.phase,
        ...(lastError.status !== undefined && { status: lastError.status }),
        ...(lastError.providerId && { providerId: lastError.providerId }),
        ...(lastError.model && { model: lastError.model }),
        ...(lastError.userMessage && { userMessage: lastError.userMessage }),
        ...(lastError.recoveryAction && {
          recoveryAction: lastError.recoveryAction
        })
      }),
      cause: lastError,
      debug: { attemptedRoutes, routeErrors }
    }
  )
}

/**
 * Ensures the shared embedding model is loaded and ready in the background.
 * Prevents first-use latency by "warming up" the model if configured.
 */
export const ensureEmbeddingStrategyReady =
  async (): Promise<EmbeddingStrategyReadiness> => {
    const config = await getEmbeddingConfig()
    const sharedProviderId =
      config.sharedEmbeddingProviderId || DEFAULT_SHARED_EMBEDDING_PROVIDER_ID
    const sharedModel = normalizeModelForProvider(
      sharedProviderId,
      config.sharedEmbeddingModel || DEFAULT_EMBEDDING_MODEL
    )

    if (!config.warmupEmbeddingsInBackground) {
      return {
        ready: true,
        warmingUp: false,
        details: "Background warmup disabled in settings."
      }
    }

    await scheduleSharedModelWarmup(sharedProviderId, sharedModel)

    return {
      ready: true,
      warmingUp: true,
      details: `Warming shared model ${sharedModel} on ${sharedProviderId}.`
    }
  }
