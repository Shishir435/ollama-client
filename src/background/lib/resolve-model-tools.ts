import { DEFAULT_PROVIDER_ID } from "@/lib/constants"
import { logger } from "@/lib/logger"
import { getModelCapabilities } from "@/lib/providers/capabilities"
import { getModelCapabilityOverride } from "@/lib/providers/model-capability-overrides"
import type { LLMProvider } from "@/lib/providers/types"
import type { ToolDefinition } from "@/lib/tools"
import { getToolRegistry } from "@/lib/tools"

/**
 * Caches a model's `/api/show` capability tags briefly, keyed by the provider
 * endpoint and model. Ollama model files can be replaced while the service
 * worker stays alive, so this must not be a lifetime cache.
 */
const CAPABILITY_TAGS_CACHE_TTL_MS = 60_000

interface CapabilityTagsCacheEntry {
  tags: string[] | undefined
  expiresAt: number
}

const capabilityTagsCache = new Map<string, CapabilityTagsCacheEntry>()

export const clearModelToolCapabilityCache = () => {
  capabilityTagsCache.clear()
}

/**
 * Resolve the tools to offer a model for one chat turn, gated on the model's
 * resolved `toolCalling` capability (override → metadata → provider default —
 * the same chain the UI uses). Returns `undefined` when the model can't call
 * tools or no tools are registered, so the request stays byte-identical to the
 * pre-tool-calling shape and non-tool models are unaffected.
 */
export const resolveModelTools = async (
  model: string,
  providerId: string | undefined,
  provider: LLMProvider
): Promise<ToolDefinition[] | undefined> => {
  const resolvedProviderId = providerId || DEFAULT_PROVIDER_ID
  const providerUrl = provider.config.baseUrl || ""
  const cacheKey = `${resolvedProviderId}::${providerUrl}::${model}`

  let ollamaCapabilities: string[] | undefined
  const cached = capabilityTagsCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) {
    ollamaCapabilities = cached.tags
  } else if (provider.getModelDetails) {
    try {
      const details = await provider.getModelDetails(model)
      ollamaCapabilities = (details as { capabilities?: string[] } | null)
        ?.capabilities
      capabilityTagsCache.set(cacheKey, {
        tags: ollamaCapabilities,
        expiresAt: Date.now() + CAPABILITY_TAGS_CACHE_TTL_MS
      })
    } catch (error) {
      logger.debug(
        "Failed to read model details for tool gating",
        "resolveModelTools",
        {
          error
        }
      )
    }
  }

  const override = await getModelCapabilityOverride(resolvedProviderId, model)
  const capabilities = getModelCapabilities({
    providerId: resolvedProviderId,
    ollamaCapabilities,
    override
  })

  if (!capabilities.toolCalling) return undefined

  const definitions = await getToolRegistry().listDefinitions()
  return definitions.length > 0 ? definitions : undefined
}
