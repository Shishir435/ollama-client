import type { AgentPanelSnapshot } from "@ollama-client/contracts"

import { resolveAgentModelCompatibility } from "@/application/agent/agent-model-compatibility"
import { resolveProviderBaseUrl } from "@/lib/providers/base-url"
import { ProviderManager } from "@/lib/providers/manager"
import { readStoredSetting } from "@/lib/storage/setting-access"
import { SETTINGS } from "@/lib/storage/settings"

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"])

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
 * Whether the selected model reads images, remembered per model for this
 * worker's life. The answer costs a catalog round trip, and the panel asks
 * for a disclosure on every snapshot; a model's modality does not change
 * between them. A failed lookup is "unknown", never "no".
 */
const visionByModel = new Map<string, boolean | undefined>()

const resolveVision = async (
  providerId: string,
  modelId: string,
  resolve: typeof resolveAgentModelCompatibility
): Promise<boolean | undefined> => {
  const key = `${providerId}\u0000${modelId}`
  if (visionByModel.has(key)) return visionByModel.get(key)
  let vision: boolean | undefined
  try {
    vision = (await resolve(providerId, modelId)).vision === true
  } catch {
    vision = undefined
  }
  if (vision !== undefined) visionByModel.set(key, vision)
  return vision
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
  const screenshots = await resolveVision(
    selected.providerId,
    selected.modelId,
    dependencies.resolveCompatibility ?? resolveAgentModelCompatibility
  )
  return {
    name: config.name || selected.providerId,
    model: selected.modelId,
    location: locationOf(resolveProviderBaseUrl(config)),
    ...(screenshots !== undefined ? { screenshots } : {})
  }
}
