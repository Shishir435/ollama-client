import { browser } from "@/lib/browser-api"
import {
  DEFAULT_EMBEDDING_MODEL,
  DEFAULT_PROVIDER_ID,
  DEFAULT_SHARED_EMBEDDING_PROVIDER_ID,
  MESSAGE_KEYS,
  normalizeEmbeddingModelName,
  STORAGE_KEYS
} from "@/lib/constants"
import { logger } from "@/lib/logger"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"
import { ProviderFactory } from "@/lib/providers/factory"
import type { LLMProvider } from "@/lib/providers/types"
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
}

const WARMUP_COOLDOWN_MS = 5 * 60 * 1000
const warmupThrottle = new Map<string, number>()

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
    const selectedChatModel = await plasmoGlobalStorage.get<string>(
      STORAGE_KEYS.PROVIDER.SELECTED_MODEL
    )

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
  const stored = await plasmoGlobalStorage.get<string>(
    STORAGE_KEYS.EMBEDDINGS.SELECTED_MODEL
  )
  return stored || DEFAULT_EMBEDDING_MODEL
}

const tryEmbed = async (
  text: string,
  attempt: EmbedAttempt
): Promise<EmbeddingStrategyResult | null> => {
  const provider = await ProviderFactory.getProvider(attempt.providerId)

  if (!provider.embed) {
    return null
  }

  // Truncate text to prevent context length errors (default ~500 tokens = ~2000 chars)
  const MAX_EMBED_CHARS = 2000
  const truncatedText =
    text.length > MAX_EMBED_CHARS
      ? `${text.slice(0, MAX_EMBED_CHARS)}...`
      : text

  const vector = await provider.embed(truncatedText, attempt.model)
  if (!Array.isArray(vector) || vector.length === 0) {
    return null
  }

  return {
    embedding: vector,
    model: attempt.model,
    providerId: provider.id,
    route: attempt.route,
    attemptedRoutes: [attempt.route]
  }
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

  const sendMessage = browser?.runtime?.sendMessage
  if (typeof sendMessage !== "function") {
    return
  }

  // Fire-and-forget warmup request so UI remains responsive.
  try {
    void sendMessage
      .call(browser.runtime, {
        type: MESSAGE_KEYS.PROVIDER.PREPARE_EMBEDDING_MODEL,
        payload: {
          providerId,
          model
        }
      })
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

const buildAttempts = async (
  requestedModel?: string
): Promise<{
  attempts: EmbedAttempt[]
  sharedAttempt?: EmbedAttempt
}> => {
  const config = await getEmbeddingConfig()
  const activeProvider = await getActiveProvider()
  const sharedProviderId =
    config.sharedEmbeddingProviderId || DEFAULT_SHARED_EMBEDDING_PROVIDER_ID
  const sharedModel = config.sharedEmbeddingModel || DEFAULT_EMBEDDING_MODEL
  const storedEmbeddingModel = await getStoredEmbeddingModel()

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
  const providerNativeAttempt = activeProvider?.embed
    ? {
        providerId: activeProvider.id,
        route: "provider-native" as const,
        model: providerNativeModel
      }
    : undefined
  const sharedAttempt: EmbedAttempt = {
    providerId: sharedProviderId,
    route: "shared-model",
    model: sharedModelResolved
  }
  const defaultProviderAttempt: EmbedAttempt = {
    providerId: DEFAULT_PROVIDER_ID,
    route: "default-provider-fallback",
    model: defaultProviderFallbackModel
  }

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

export const generateEmbeddingWithStrategy = async (
  text: string,
  requestedModel?: string
): Promise<EmbeddingStrategyResult> => {
  const { attempts, sharedAttempt } = await buildAttempts(requestedModel)
  const attemptedRoutes: EmbeddingRoute[] = []
  const routeErrors: string[] = []

  for (const attempt of attempts) {
    attemptedRoutes.push(attempt.route)

    try {
      const result = await tryEmbed(text, attempt)
      if (result) {
        result.attemptedRoutes = [...attemptedRoutes]
        return result
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error)
      routeErrors.push(`${attempt.route}: ${errorMessage}`)
      logger.warn(
        `Embedding route failed: ${attempt.route}`,
        "EmbeddingStrategy",
        {
          providerId: attempt.providerId,
          model: attempt.model,
          error
        }
      )

      // Shared model failure in auto path triggers best-effort background warmup.
      if (attempt.route === "shared-model" && sharedAttempt) {
        attemptedRoutes.push("shared-model-warmup")
        const config = await getEmbeddingConfig()
        if (config.warmupEmbeddingsInBackground) {
          void scheduleSharedModelWarmup(
            sharedAttempt.providerId,
            sharedAttempt.model
          )
        }
      }
    }
  }

  throw new Error(
    `All embedding routes failed. Attempted: ${attemptedRoutes.join(" -> ")}. Last error: ${
      routeErrors[routeErrors.length - 1] || "unknown"
    }`
  )
}

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
