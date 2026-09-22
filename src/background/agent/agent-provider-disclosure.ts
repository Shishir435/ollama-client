import type {
  AgentModelReadiness,
  AgentPanelSnapshot
} from "@ollama-client/contracts"

import {
  type AgentModelCompatibility,
  resolveAgentModelCompatibility
} from "@/application/agent/agent-model-compatibility"
import { agentModelReadiness } from "@/application/agent/agent-model-readiness"
import { browser } from "@/lib/browser-api"
import { STORAGE_KEYS } from "@/lib/constants"
import { resolveProviderBaseUrl } from "@/lib/providers/base-url"
import { getModelCapabilityStates } from "@/lib/providers/capabilities"
import { ProviderFactory } from "@/lib/providers/factory"
import { ProviderManager } from "@/lib/providers/manager"
import { discoverProviderModels } from "@/lib/providers/model-discovery"
import { ProviderStorageKey } from "@/lib/providers/types"
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
 * What the selected model can do, remembered per model between snapshots.
 *
 * The answer costs a catalog round trip and, where the provider has one, a
 * model-details request; the panel asks for a disclosure on every snapshot,
 * and nothing about a model changes between two of them on its own.
 *
 * Only a fully determined answer is kept. An unsupported verdict may become
 * supported once a probe runs, and an undetermined vision may become a stated
 * one once a catalog answers — caching either would freeze a stale refusal in
 * front of Start.
 *
 * The evidence behind a kept answer can change too, and this cache now gates a
 * button rather than decorating a notice: a remembered "ready" that the run
 * itself would refuse puts the refusal back where this change moved it from,
 * after the browser has attached. So it is invalidated from the same evidence
 * the resolver reads, rather than expiring on a timer — bounded staleness is
 * not good enough for a gate.
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
  if (settled(compatibility)) {
    watchEvidence()
    compatibilityByModel.set(key, compatibility)
  }
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

/**
 * The keys that decide a verdict: the user's own overrides, what a probe
 * learned, and the provider configs that say which server was asked. A change
 * to any of them makes every remembered answer a claim about evidence that is
 * no longer current, so the whole cache goes rather than one entry — the keys
 * are maps covering every model, and reading which entries moved would be a
 * second copy of the resolver.
 */
const EVIDENCE_KEYS = [
  STORAGE_KEYS.PROVIDER.MODEL_CAPABILITY_OVERRIDES,
  STORAGE_KEYS.PROVIDER.MODEL_CAPABILITY_PROBES,
  STORAGE_KEYS.PROVIDER.MODEL_CATALOG_SUPPORT,
  ProviderStorageKey.CONFIG
]

let watchingEvidence = false

/**
 * Matched on key alone rather than area: the storage wrapper routes by
 * registry scope, and a key that moves between areas must still invalidate.
 * A context with no storage API leaves the caches unregistered and therefore
 * unused, which is the behaviour this replaces.
 */
const watchEvidence = (): void => {
  if (watchingEvidence) return
  watchingEvidence = true
  try {
    const onChanged = browser.storage?.onChanged
    if (!onChanged?.addListener) return
    onChanged.addListener((changes) => {
      if (!EVIDENCE_KEYS.some((key) => key in changes)) return
      compatibilityByModel.clear()
      alternativesByProvider.clear()
    })
  } catch {
    /** No storage API here; nothing was cached under it either. */
  }
}

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
          .filter((model) => {
            const { toolCalling } = getModelCapabilityStates({
              providerId,
              lmStudioModelType: model.capabilityHints?.modelType,
              capabilityTags: model.capabilityHints?.capabilityTags,
              contextLength: model.capabilityHints?.contextLength,
              modalities: model.capabilityHints?.modalities,
              outputModalities: model.capabilityHints?.outputModalities,
              supportedParameters: model.capabilityHints?.supportedParameters
            })
            /**
             * The model's own word, never the provider's default. Ollama's
             * `/api/tags` rows carry no capability hints at all, so a status
             * alone resolves from the provider default and would list every
             * installed model as an alternative — sending a refused user
             * straight to another model that cannot call tools either.
             * Suggesting nothing is the correct answer for a catalog that
             * says nothing.
             */
            return (
              toolCalling.status === "supported" &&
              toolCalling.source !== "provider-default"
            )
          })
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

/**
 * A lookup that could not be made is reported as a verdict, not withheld.
 *
 * Withholding it left the panel with a provider and no readiness, which the
 * Start gate read as "still resolving" and allowed — so a provider that could
 * not be reached started a run, attached to a tab, and was refused at planning
 * time, which is the sequence this whole change exists to remove. Unknown is
 * also the honest word: nothing was learned, and a run does not enable tool
 * calling on a guess. It is never cached, so the next snapshot asks again.
 */
const UNRESOLVED: AgentModelReadiness = {
  status: "unsupported",
  reason: "unknown",
  vision: "unknown"
}

const readinessFor = async (
  providerId: string,
  modelId: string,
  resolve: typeof resolveAgentModelCompatibility
): Promise<AgentModelReadiness> => {
  const compatibility = await resolveCompatibility(providerId, modelId, resolve)
  const readiness = compatibility
    ? agentModelReadiness(compatibility)
    : UNRESOLVED
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
    readiness.vision === "unknown"
      ? undefined
      : readiness.vision === "supported"
  return {
    name: config.name || selected.providerId,
    model: selected.modelId,
    location: locationOf(resolveProviderBaseUrl(config)),
    ...(screenshots !== undefined ? { screenshots } : {}),
    readiness
  }
}
