import {
  getModelCapabilityStates,
  type ModelCapabilityOverride,
  type ModelCapabilityState
} from "@/lib/providers/capabilities"
import {
  type CapabilityProbeResult,
  getCapabilityProbe,
  TOOL_CALLING_PROBE_VERSION
} from "@/lib/providers/capability-probe"
import { ProviderFactory } from "@/lib/providers/factory"
import { getModelCapabilityOverride } from "@/lib/providers/model-capability-overrides"
import {
  discoverProviderModels,
  type ModelDiscoveryResult
} from "@/lib/providers/model-discovery"
import type { LLMProvider } from "@/lib/providers/types"

export type AgentModelCompatibility =
  | {
      status: "supported"
      mode: "native" | "native-user-results"
      reason: "metadata" | "verified_probe"
    }
  | {
      status: "experimental"
      mode: "native"
      reason: "user_override"
    }
  | {
      status: "unsupported"
      reason: "reported_unsupported" | "unverified" | "unknown"
    }

export class AgentModelCompatibilityError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "AgentModelCompatibilityError"
  }
}

export const assertAgentModelCompatibility = (
  compatibility: AgentModelCompatibility,
  allowExperimental = false
): void => {
  if (compatibility.status === "supported") return
  if (compatibility.status === "experimental" && allowExperimental) return
  throw new AgentModelCompatibilityError(
    compatibility.status === "experimental"
      ? "Experimental Agent model use requires an explicit override"
      : `The selected model is not Agent compatible: ${compatibility.reason}`
  )
}

export const deriveAgentModelCompatibility = (input: {
  toolCalling: ModelCapabilityState
  probe?: CapabilityProbeResult | null
}): AgentModelCompatibility => {
  if (input.toolCalling.status === "unsupported") {
    return { status: "unsupported", reason: "reported_unsupported" }
  }
  if (input.toolCalling.status === "unknown") {
    return { status: "unsupported", reason: "unknown" }
  }
  if (input.toolCalling.source === "user-override") {
    return { status: "experimental", mode: "native", reason: "user_override" }
  }
  if (input.toolCalling.source === "model-metadata") {
    return { status: "supported", mode: "native", reason: "metadata" }
  }
  if (
    input.toolCalling.source === "probed" &&
    input.probe?.toolCalling === true &&
    input.probe.toolCallingProbeVersion === TOOL_CALLING_PROBE_VERSION &&
    input.probe.toolCallingMode
  ) {
    return {
      status: "supported",
      mode: input.probe.toolCallingMode,
      reason: "verified_probe"
    }
  }
  return { status: "unsupported", reason: "unverified" }
}

export interface AgentModelCompatibilityResolverDependencies {
  resolveProvider?: (providerId: string) => Promise<LLMProvider>
  discoverModels?: (
    provider: LLMProvider,
    signal?: AbortSignal
  ) => Promise<ModelDiscoveryResult>
  getProbe?: (
    providerId: string,
    modelId: string
  ) => Promise<CapabilityProbeResult | null>
  getOverride?: (
    providerId: string,
    modelId: string
  ) => Promise<ModelCapabilityOverride | null>
}

/** Re-derives compatibility in the privileged owner; UI evidence is never authorization. */
export const resolveAgentModelCompatibility = async (
  providerId: string,
  modelId: string,
  signal?: AbortSignal,
  dependencies: AgentModelCompatibilityResolverDependencies = {}
): Promise<AgentModelCompatibility> => {
  const resolveProvider =
    dependencies.resolveProvider ?? ProviderFactory.getProvider
  const discoverModels = dependencies.discoverModels ?? discoverProviderModels
  const readProbe = dependencies.getProbe ?? getCapabilityProbe
  const readOverride = dependencies.getOverride ?? getModelCapabilityOverride
  const provider = await resolveProvider(providerId)
  const [discovery, probe, override] = await Promise.all([
    discoverModels(provider, signal),
    readProbe(providerId, modelId),
    readOverride(providerId, modelId)
  ])
  signal?.throwIfAborted()
  const model = discovery.models.find((candidate) => candidate.name === modelId)
  const details =
    provider.capabilities.modelDetails && provider.getModelDetails
      ? await provider.getModelDetails(modelId, signal).catch(() => null)
      : null
  signal?.throwIfAborted()
  const states = getModelCapabilityStates({
    providerId,
    ollamaCapabilities: details?.capabilities,
    lmStudioModelType: model?.capabilityHints?.modelType,
    capabilityTags: model?.capabilityHints?.capabilityTags,
    contextLength: model?.capabilityHints?.contextLength,
    modalities: model?.capabilityHints?.modalities,
    outputModalities: model?.capabilityHints?.outputModalities,
    supportedParameters: model?.capabilityHints?.supportedParameters,
    override,
    probed: probe
  })
  return deriveAgentModelCompatibility({
    toolCalling: states.toolCalling,
    probe
  })
}
