import { DEFAULT_PROVIDER_ID } from "@/lib/constants"
import { logger } from "@/lib/logger"
import { getModelCapabilities } from "@/lib/providers/capabilities"
import { getCapabilityProbe } from "@/lib/providers/capability-probe"
import { getModelCapabilityOverride } from "@/lib/providers/model-capability-overrides"
import type { LLMProvider } from "@/lib/providers/types"
import type { ToolDefinition } from "@/lib/tools"
import { getToolRegistry } from "@/lib/tools"
import { isAgentBrowserTool } from "@/lib/tools/internal/agent-browser-tools"
import { getToolFamily } from "@/lib/tools/tool-families"
import {
  getEffectiveToolFamilySettings,
  getToolModelOverride
} from "@/lib/tools/tool-model-overrides"

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

/** How the resolved tools should be driven for this turn. */
export type ToolCallingMode = "native" | "non-native"

export interface ResolvedModelTools {
  tools: ToolDefinition[]
  mode: ToolCallingMode
}

/**
 * Resolve the tools to offer a model for one chat turn.
 *
 * When the model's resolved `toolCalling` capability is true (override →
 * metadata → provider default — the same chain the UI uses), tools are driven
 * natively. When it is false, tools are offered only if the user opted this
 * model into the prompt-based `nonNativeToolFallback`; otherwise the model gets
 * no tools and the request stays byte-identical to the pre-tool-calling shape.
 *
 * Returns `undefined` when no tools should be offered (governance off, none
 * registered, or non-tool-calling model without the fallback opt-in).
 */
export const resolveModelTools = async (
  model: string,
  providerId: string | undefined,
  provider: LLMProvider,
  options?: { agentMode?: boolean }
): Promise<ResolvedModelTools | undefined> => {
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

  const [override, probed] = await Promise.all([
    getModelCapabilityOverride(resolvedProviderId, model),
    getCapabilityProbe(resolvedProviderId, model)
  ])
  const capabilities = getModelCapabilities({
    providerId: resolvedProviderId,
    ollamaCapabilities,
    override,
    probed
  })

  // Native when the model supports tool-calling; otherwise fall back to the
  // prompt-based path only if the user opted this model in. Off by default, so a
  // non-tool-calling model without the opt-in gets no tools (unchanged behavior).
  let mode: ToolCallingMode
  if (capabilities.toolCalling) {
    mode = "native"
  } else {
    const override = await getToolModelOverride(resolvedProviderId, model)
    if (!override?.nonNativeToolFallback) return undefined
    mode = "non-native"
  }

  // Governance: the user gates which tool families a model may be offered.
  // Master off → no tools at all; otherwise drop tools whose family is disabled.
  // Effective settings = global family defaults (E10) with any per-model override
  // layered on top (0.11.18). Defaults are all-on with no override, so this stays
  // byte-identical to pre-governance until a user turns something off.
  const toolSettings = await getEffectiveToolFamilySettings(
    resolvedProviderId,
    model
  )
  if (!toolSettings.enabled) return undefined

  const definitions = await getToolRegistry().listDefinitions()
  const allowed = definitions.filter((definition) => {
    if (isAgentBrowserTool(definition.name) && !options?.agentMode) return false
    if (
      options?.agentMode &&
      definition.name !== "list_tabs" &&
      !isAgentBrowserTool(definition.name)
    ) {
      return false
    }
    if (toolSettings.families[getToolFamily(definition)] === false) return false
    // Vision-only tools (e.g. capture_screenshot) are useless to a model that
    // can't see images — don't offer them, or the model may call one and choke
    // on the returned image.
    if (definition.requires?.includes("vision") && !capabilities.vision) {
      return false
    }
    return true
  })
  return allowed.length > 0 ? { tools: allowed, mode } : undefined
}
