import { DEFAULT_PROVIDER_ID } from "@/lib/constants"
import { logger } from "@/lib/logger"
import { resolveProviderBaseUrl } from "@/lib/providers/base-url"
import {
  getModelCapabilities,
  type ModelCapabilities
} from "@/lib/providers/capabilities"
import type { CapabilityProbeResult } from "@/lib/providers/capability-probe"
import { getCapabilityProbe } from "@/lib/providers/capability-probe"
import { getModelCapabilityOverride } from "@/lib/providers/model-capability-overrides"
import { discoverProviderModels } from "@/lib/providers/model-discovery"
import type { LLMProvider } from "@/lib/providers/types"
import type { ToolDefinition } from "@/lib/tools"
import { getToolRegistry } from "@/lib/tools"
import { getToolFamily } from "@/lib/tools/tool-families"
import {
  getEffectiveToolFamilySettings,
  getToolModelOverride
} from "@/lib/tools/tool-model-overrides"
import { filterToolsForTurn } from "./tool-exposure-policy"

/**
 * Caches a model's `/api/show` capability tags briefly, keyed by the provider
 * endpoint and model. Ollama model files can be replaced while the service
 * worker stays alive, so this must not be a lifetime cache.
 */
const CAPABILITY_TAGS_CACHE_TTL_MS = 60_000

interface CapabilityTagsCacheEntry {
  tags: string[] | undefined
  modelType?: string
  /** Model-level tags a catalog reports, e.g. LM Studio's ["tool_use"]. */
  capabilityTags?: string[]
  contextLength?: number
  modalities?: string[]
  outputModalities?: string[]
  supportedParameters?: string[]
  expiresAt: number
}

const capabilityTagsCache = new Map<string, CapabilityTagsCacheEntry>()

const throwIfAborted = (signal?: AbortSignal): void => {
  signal?.throwIfAborted()
}

export const clearModelToolCapabilityCache = () => {
  capabilityTagsCache.clear()
}

/** How the resolved tools should be driven for this turn. */
export type ToolCallingMode = "native" | "native-user-results" | "non-native"

export interface ResolvedModelTools {
  tools: ToolDefinition[]
  mode: ToolCallingMode
}

export interface ResolvedModelCapabilities {
  capabilities: ModelCapabilities
  probed: CapabilityProbeResult | null
}

/** Resolve one model's shared capability chain for any background consumer. */
export const resolveModelCapabilities = async (
  model: string,
  providerId: string | undefined,
  provider: LLMProvider,
  signal?: AbortSignal
): Promise<ResolvedModelCapabilities> => {
  throwIfAborted(signal)
  const resolvedProviderId = providerId || DEFAULT_PROVIDER_ID
  const providerUrl = resolveProviderBaseUrl(provider.config)
  const cacheKey = `${resolvedProviderId}::${providerUrl}::${model}`

  let metadata: Omit<CapabilityTagsCacheEntry, "expiresAt"> = {
    tags: undefined
  }
  const cached = capabilityTagsCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) {
    metadata = cached
  } else {
    throwIfAborted(signal)
    let resolvedMetadata = false
    if (provider.getModelDetails) {
      try {
        const details = await provider.getModelDetails(model, signal)
        const tags = (details as { capabilities?: string[] } | null)
          ?.capabilities
        if (tags?.length) {
          metadata = { tags }
          resolvedMetadata = true
        }
      } catch (error) {
        throwIfAborted(signal)
        logger.debug(
          "Failed to read model details for capability gating",
          "resolveModelCapabilities",
          { error }
        )
      }
    }

    if (!resolvedMetadata && provider.capabilities?.modelDiscovery) {
      try {
        const { models } = await discoverProviderModels(provider, signal)
        const servedModel = models.find((candidate) => candidate.name === model)
        if (servedModel) {
          metadata = {
            tags: undefined,
            modelType: servedModel.capabilityHints?.modelType,
            capabilityTags: servedModel.capabilityHints?.capabilityTags,
            contextLength: servedModel.capabilityHints?.contextLength,
            modalities: servedModel.capabilityHints?.modalities,
            outputModalities: servedModel.capabilityHints?.outputModalities,
            supportedParameters:
              servedModel.capabilityHints?.supportedParameters
          }
          resolvedMetadata = true
        }
      } catch (error) {
        throwIfAborted(signal)
        logger.debug(
          "Failed to read model catalog metadata for capability gating",
          "resolveModelCapabilities",
          { error }
        )
      }
    }

    if (resolvedMetadata) {
      capabilityTagsCache.set(cacheKey, {
        ...metadata,
        expiresAt: Date.now() + CAPABILITY_TAGS_CACHE_TTL_MS
      })
    }
  }

  const [override, probed] = await Promise.all([
    getModelCapabilityOverride(resolvedProviderId, model),
    getCapabilityProbe(resolvedProviderId, model)
  ])
  return {
    capabilities: getModelCapabilities({
      providerId: resolvedProviderId,
      ollamaCapabilities: metadata.tags,
      lmStudioModelType: metadata.modelType,
      capabilityTags: metadata.capabilityTags,
      contextLength: metadata.contextLength,
      modalities: metadata.modalities,
      outputModalities: metadata.outputModalities,
      supportedParameters: metadata.supportedParameters,
      override,
      probed
    }),
    probed
  }
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
  latestUserText?: string,
  resolvedCapabilities?: ResolvedModelCapabilities,
  signal?: AbortSignal
): Promise<ResolvedModelTools | undefined> => {
  throwIfAborted(signal)
  const resolvedProviderId = providerId || DEFAULT_PROVIDER_ID
  const { capabilities, probed } =
    resolvedCapabilities ??
    (await resolveModelCapabilities(model, providerId, provider, signal))

  // Native when the model supports tool-calling; otherwise fall back to the
  // prompt-based path only if the user opted this model in. Off by default, so a
  // non-tool-calling model without the opt-in gets no tools (unchanged behavior).
  let mode: ToolCallingMode
  if (capabilities.toolCalling) {
    mode =
      probed?.toolCalling === true &&
      probed.toolCallingMode === "native-user-results"
        ? "native-user-results"
        : "native"
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
  const governed = definitions.filter((definition) => {
    if (toolSettings.families[getToolFamily(definition)] === false) return false
    // Vision-only tools (e.g. capture_screenshot) are useless to a model that
    // can't see images — don't offer them, or the model may call one and choke
    // on the returned image.
    if (definition.requires?.includes("vision") && !capabilities.vision) {
      return false
    }
    return true
  })
  // Apply the provider-independent, turn-level safety policy last. Sensitive
  // browser-data tools are not sent to any provider unless their optional
  // permission is already granted and this request explicitly asks for them.
  const allowed = await filterToolsForTurn(governed, latestUserText)
  return allowed.length > 0 ? { tools: allowed, mode } : undefined
}
