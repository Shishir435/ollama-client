import type { AgentPanelSnapshot } from "@ollama-client/contracts"

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

/** The provider the panel discloses before page observations are sent. */
export const resolveAgentProviderDisclosure = async (): Promise<
  AgentPanelSnapshot["provider"]
> => {
  const selected = await readStoredSetting(SETTINGS.SELECTED_MODEL_REF)
  if (!selected) return undefined
  const config = await ProviderManager.getProviderConfig(selected.providerId)
  if (!config) return undefined
  return {
    name: config.name || selected.providerId,
    model: selected.modelId,
    location: locationOf(resolveProviderBaseUrl(config))
  }
}
