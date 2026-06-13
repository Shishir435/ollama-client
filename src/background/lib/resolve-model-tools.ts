import { DEFAULT_PROVIDER_ID } from "@/lib/constants"
import { logger } from "@/lib/logger"
import { getModelCapabilities } from "@/lib/providers/capabilities"
import { getModelCapabilityOverride } from "@/lib/providers/model-capability-overrides"
import type { LLMProvider } from "@/lib/providers/types"
import type { ToolDefinition } from "@/lib/tools"
import { getToolRegistry } from "@/lib/tools"

/**
 * Caches a model's `/api/show` capability tags for the session, keyed by
 * `providerId::model`. The tags don't change while the extension runs, so this
 * avoids a network round-trip on every message; the user override is still read
 * fresh each call (it's a cheap local read and can change at any time).
 */
const capabilityTagsCache = new Map<string, string[] | undefined>()

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
  const cacheKey = `${resolvedProviderId}::${model}`

  let ollamaCapabilities: string[] | undefined
  if (capabilityTagsCache.has(cacheKey)) {
    ollamaCapabilities = capabilityTagsCache.get(cacheKey)
  } else if (provider.getModelDetails) {
    try {
      const details = await provider.getModelDetails(model)
      ollamaCapabilities = (details as { capabilities?: string[] } | null)
        ?.capabilities
      capabilityTagsCache.set(cacheKey, ollamaCapabilities)
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
