import { DEFAULT_PROVIDER_ID } from "@/lib/constants"
import { logger } from "@/lib/logger"
import { getModelCapabilities } from "@/lib/providers/capabilities"
import { getModelCapabilityOverride } from "@/lib/providers/model-capability-overrides"
import type { LLMProvider } from "@/lib/providers/types"
import type { ToolDefinition } from "@/lib/tools"
import { getToolRegistry } from "@/lib/tools"

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

  let ollamaCapabilities: string[] | undefined
  if (provider.getModelDetails) {
    try {
      const details = await provider.getModelDetails(model)
      ollamaCapabilities = (details as { capabilities?: string[] } | null)
        ?.capabilities
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
