import { isCustomProviderId, ProviderId } from "@/lib/providers/types"
import type { ProviderDraft } from "../types/provider-draft"
import type { ProviderConnectionStatus } from "./provider-draft-reducer"

const LOCAL_PROVIDER_IDS = [
  ProviderId.OLLAMA,
  ProviderId.LM_STUDIO,
  ProviderId.LLAMA_CPP
]

const isLocalhostEndpoint = (baseUrl?: string) => {
  const url = baseUrl?.trim()
  if (!url) return false
  try {
    return ["localhost", "127.0.0.1", "::1"].includes(new URL(url).hostname)
  } catch {
    return false
  }
}

const getCspCompatibilityHint = (baseUrl?: string) => {
  const trimmedUrl = baseUrl?.trim()
  if (!trimmedUrl) return null
  try {
    const parsed = new URL(trimmedUrl)
    if (["localhost", "127.0.0.1", "::1"].includes(parsed.hostname)) {
      return null
    }
    return 'If you are on an older extension build and see "Failed to fetch" with Content Security Policy errors, update/reload the extension to apply LAN endpoint support.'
  } catch {
    return null
  }
}

interface ProviderHealthState {
  success: boolean
  modelListSupported?: boolean
}

type HeaderStatus = {
  dot: string
  label:
    | "inactive"
    | "manual_models"
    | "connected"
    | "connection_failed"
    | "not_tested"
}

export const deriveProviderSettingsView = (input: {
  providers: ProviderDraft[]
  selectedId: string
  connectionStatus: ProviderConnectionStatus | null
  providerHealth: Record<string, ProviderHealthState | undefined>
  defaultUrl: string
}) => {
  const activeConfig = input.providers.find(
    (provider) => provider.id === input.selectedId
  )
  const health = activeConfig
    ? input.providerHealth[String(activeConfig.id)]
    : undefined

  let headerStatus: HeaderStatus = {
    dot: "bg-status-warning ring-status-warning/30",
    label: "not_tested"
  }
  if (!activeConfig?.enabled) {
    headerStatus = {
      dot: "bg-muted-foreground/40 ring-muted-foreground/20",
      label: "inactive"
    }
  } else if (
    input.connectionStatus === null &&
    health?.modelListSupported === false
  ) {
    headerStatus = {
      dot: "bg-status-warning ring-status-warning/30",
      label: "manual_models"
    }
  } else if (input.connectionStatus?.success ?? health?.success) {
    headerStatus = {
      dot: "bg-status-success ring-status-success/30",
      label: "connected"
    }
  } else if (
    input.connectionStatus?.success === false ||
    health?.success === false
  ) {
    headerStatus = {
      dot: "bg-status-danger ring-status-danger/30",
      label: "connection_failed"
    }
  }

  return {
    activeConfig,
    cspCompatibilityHint: getCspCompatibilityHint(activeConfig?.baseUrl),
    displayUrl: activeConfig?.baseUrl || input.defaultUrl,
    isCustomProvider: activeConfig
      ? isCustomProviderId(String(activeConfig.id))
      : false,
    isLocalProvider: LOCAL_PROVIDER_IDS.includes(
      activeConfig?.id as ProviderId
    ),
    isRemoteEndpoint:
      Boolean(activeConfig?.baseUrl?.trim()) &&
      !isLocalhostEndpoint(activeConfig?.baseUrl),
    headerStatus
  }
}
