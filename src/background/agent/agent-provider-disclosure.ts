import type {
  AgentModelReadiness,
  AgentPanelSnapshot
} from "@ollama-client/contracts"

import {
  type AgentModelCompatibility,
  resolveAgentModelCompatibility
} from "@/application/agent/agent-model-compatibility"
import { agentModelReadiness } from "@/application/agent/agent-model-readiness"
import { resolveProviderBaseUrl } from "@/lib/providers/base-url"
import { getModelCapabilityStates } from "@/lib/providers/capabilities"
import { ProviderFactory } from "@/lib/providers/factory"
import { ProviderManager } from "@/lib/providers/manager"
import { discoverProviderModels } from "@/lib/providers/model-discovery"
import { readStoredSetting } from "@/lib/storage/setting-access"
import { SETTINGS } from "@/lib/storage/settings"

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"])

/** How many models a refusal may suggest. A hint, not a model picker. */
const MAX_ALTERNATIVES = 3

/**
 * Where the endpoint lives — not where the weights run.
 *
 * A loopback address proves the request stays on this device; it does not
 * prove the inference does, because a local proxy may forward to a hosted
 * model. "local" therefore claims the narrower fact, and remote is assumed
 * whenever the address is not demonstrably loopback.
 */
const locationOf = (baseUrl: string): "local" | "remote" => {
  try {
    const { hostname } = new URL(baseUrl)
    if (LOOPBACK_HOSTS.has(hostname)) return "local"
    return hostname.endsWith(".localhost") ? "local" : "remote"
  } catch {
    return "remote"
  }
}

/**
 * What the selected model can do, remembered per model for this worker's life.
 *
 * The answer costs a catalog round trip and, where the provider has one, a
 * model-details request; the panel asks for a disclosure on every snapshot,
 * and a model's capabilities do not change between them.
 *
 * Only a fully determined answer is kept. An unsupported verdict may become
 * supported once a capability probe runs or the user sets an override, and an
 * undetermined vision may become a stated one once a catalog answers — caching
 * either would freeze a stale refusal in front of the Start button for as long
 * as the worker lives.
 */
const compatibilityByModel = new Map<string, AgentModelCompatibility>()

const settled = (compatibility: AgentModelCompatibility): boolean =>
  compatibility.status !== "unsupported" && compatibility.vision !== undefined

const resolveCompatibility = async (
  providerId: string,
  modelId: string,
  resolve: typeof resolveAgentModelCompatibility
): Promise<AgentModelCompatibility | undefined> => {
  const key = `${providerId}\u0000${modelId}`
  const remembered = compatibilityByModel.get(key)
  if (remembered) return remembered
  let compatibility: AgentModelCompatibility | undefined
  try {
    compatibility = await resolve(providerId, modelId)
  } catch {
    return undefined
  }
  if (settled(compatibility)) compatibilityByModel.set(key, compatibility)
  return compatibility
}

/**
 * Models on the same provider whose own catalog says they call tools.
 *
 * Catalog hints only: this runs behind a refusal, and fanning out a details
 * request per model to decorate an error would cost more than the run the user
 * was refused. A model that needs `/api/show` to prove itself is simply not
 * suggested — under-suggesting is the safe direction for a hint.
 */
const alternativesByProvider = new Map<string, string[]>()

const resolveAlternatives = async (
  providerId: string,
  modelId: string
): Promise<string[]> => {
  const remembered = alternativesByProvider.get(providerId)
  const candidates =
    remembered ??
    (await (async () => {
      try {
        const provider = await ProviderFactory.getProvider(providerId)
        const discovery = await discoverProviderModels(provider)
        return discovery.models
          .filter(
            (model) =>
              getModelCapabilityStates({
                providerId,
                lmStudioModelType: model.capabilityHints?.modelType,
                capabilityTags: model.capabilityHints?.capabilityTags,
                contextLength: model.capabilityHints?.contextLength,
                modalities: model.capabilityHints?.modalities,
                outputModalities: model.capabilityHints?.outputModalities,
                supportedParameters: model.capabilityHints?.supportedParameters
              }).toolCalling.status === "supported"
          )
          .map((model) => model.name)
      } catch {
        return []
      }
    })())
  alternativesByProvider.set(providerId, candidates)
  return candidates
    .filter((candidate) => candidate !== modelId)
    .slice(0, MAX_ALTERNATIVES)
}

const readinessFor = async (
  providerId: string,
  modelId: string,
  resolve: typeof resolveAgentModelCompatibility
): Promise<AgentModelReadiness | undefined> => {
  const compatibility = await resolveCompatibility(providerId, modelId, resolve)
  if (!compatibility) return undefined
  const readiness = agentModelReadiness(compatibility)
  if (readiness.status !== "unsupported") return readiness
  const alternatives = await resolveAlternatives(providerId, modelId)
  return alternatives.length > 0 ? { ...readiness, alternatives } : readiness
}

/** The provider the panel discloses before page observations are sent. */
export const resolveAgentProviderDisclosure = async (
  providerId?: string,
  modelId?: string,
  dependencies: {
    resolveCompatibility?: typeof resolveAgentModelCompatibility
  } = {}
): Promise<AgentPanelSnapshot["provider"]> => {
  const selected =
    providerId && modelId
      ? { providerId, modelId }
      : await readStoredSetting(SETTINGS.SELECTED_MODEL_REF)
  if (!selected) return undefined
  const config = await ProviderManager.getProviderConfig(selected.providerId)
  if (!config) return undefined
  const readiness = await readinessFor(
    selected.providerId,
    selected.modelId,
    dependencies.resolveCompatibility ?? resolveAgentModelCompatibility
  )
  /**
   * Read off readiness rather than resolved a second time: "unknown" is not
   * "no", and the panel has a state for not knowing. Reading it as `false`
   * told the user "Not used with a text-only model" about a model whose own
   * catalog reports vision.
   */
  const screenshots =
    readiness && readiness.vision !== "unknown"
      ? readiness.vision === "supported"
      : undefined
  return {
    name: config.name || selected.providerId,
    model: selected.modelId,
    location: locationOf(resolveProviderBaseUrl(config)),
    ...(screenshots !== undefined ? { screenshots } : {}),
    ...(readiness ? { readiness } : {})
  }
}
