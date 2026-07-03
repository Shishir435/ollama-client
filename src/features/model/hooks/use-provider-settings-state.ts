import { useCallback, useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "@/hooks/use-toast"
import { DEFAULT_PROVIDER_ID } from "@/lib/constants"
import { getDisplayErrorMessage } from "@/lib/error-display"
import { logger } from "@/lib/logger"
import { ProviderFactory } from "@/lib/providers/factory"
import { ProviderManager } from "@/lib/providers/manager"
import {
  type CustomProviderWire,
  isCustomProviderId,
  type ProviderConfig,
  ProviderId,
  ProviderType
} from "@/lib/providers/types"
import { useProviderHealth } from "./use-provider-health"

const LOCAL_PROVIDER_IDS = [
  ProviderId.OLLAMA,
  ProviderId.LM_STUDIO,
  ProviderId.LLAMA_CPP
]

const isLocalhostEndpoint = (baseUrl?: string) => {
  const url = baseUrl?.trim()
  if (!url) return false

  try {
    const parsed = new URL(url)
    return ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname)
  } catch {
    return false
  }
}

const getCspCompatibilityHint = (baseUrl?: string) => {
  const trimmedUrl = baseUrl?.trim()
  if (!trimmedUrl) return null

  try {
    const parsed = new URL(trimmedUrl)
    const isLocalhost = ["localhost", "127.0.0.1", "::1"].includes(
      parsed.hostname
    )

    if (isLocalhost) return null

    return 'If you are on an older extension build and see "Failed to fetch" with Content Security Policy errors, update/reload the extension to apply LAN endpoint support.'
  } catch {
    return null
  }
}

export const useProviderSettingsState = () => {
  const { t } = useTranslation()
  const [providers, setProviders] = useState<ProviderConfig[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string>(DEFAULT_PROVIDER_ID)
  const [testingConnection, setTestingConnection] = useState(false)
  const [connectionStatus, setConnectionStatus] = useState<{
    success: boolean
    message: string
  } | null>(null)
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)

  const providerHealth = useProviderHealth(providers)

  const loadProviders = useCallback(async () => {
    setLoading(true)
    try {
      const data = await ProviderManager.getProviders()
      setProviders(data)
    } catch (error) {
      logger.error("Failed to load providers", "ProviderSettings", { error })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadProviders()
  }, [loadProviders])

  // biome-ignore lint/correctness/useExhaustiveDependencies: Reset provider-specific status whenever the selected provider changes.
  useEffect(() => {
    setConnectionStatus(null)
    setHasUnsavedChanges(false)
  }, [selectedId])

  const activeConfig = providers.find((p) => p.id === selectedId)
  const cspCompatibilityHint = getCspCompatibilityHint(activeConfig?.baseUrl)
  const displayUrl =
    activeConfig?.baseUrl || t("settings.providers.test_connection.default_url")
  const isCustomProvider = activeConfig
    ? isCustomProviderId(String(activeConfig.id))
    : false
  const isLocalProvider = LOCAL_PROVIDER_IDS.includes(
    activeConfig?.id as ProviderId
  )
  const isRemoteEndpoint =
    Boolean(activeConfig?.baseUrl?.trim()) &&
    !isLocalhostEndpoint(activeConfig?.baseUrl)

  const handleTestConnection = async () => {
    if (!activeConfig) return

    logger.info("Testing connection with config", "ProviderSettings", {
      id: activeConfig.id,
      name: activeConfig.name,
      baseUrl: activeConfig.baseUrl,
      enabled: activeConfig.enabled
    })

    setTestingConnection(true)
    setConnectionStatus(null)

    // Custom endpoints may be keyless local/LAN servers — never require a key
    // for them; a real 401 from the test surfaces its own error.
    if (
      activeConfig.type === ProviderType.ANTHROPIC &&
      !activeConfig.apiKey?.trim()
    ) {
      const message = t("settings.providers.test_connection.api_key_required", {
        name: activeConfig.name
      })

      setConnectionStatus({ success: false, message })
      toast({
        title: t("settings.providers.test_connection.api_key_required_title"),
        description: message,
        variant: "destructive"
      })
      setTestingConnection(false)
      return
    }

    try {
      const provider = await ProviderFactory.getProviderWithConfig(activeConfig)
      logger.debug(
        "Provider instance created, calling getModels()",
        "ProviderSettings"
      )
      const models = await provider.getModels()
      logger.debug("getModels() succeeded", "ProviderSettings", {
        count: models.length
      })

      if (models.length === 0) {
        setConnectionStatus({
          success: false,
          message: t("settings.providers.test_connection.inline_no_models", {
            url: displayUrl
          })
        })
        toast({
          title: t("settings.providers.test_connection.no_models_title"),
          description: t(
            "settings.providers.test_connection.no_models_description",
            { url: displayUrl }
          ),
          variant: "destructive"
        })
        return
      }

      setConnectionStatus({
        success: true,
        message: t("settings.providers.test_connection.inline_success", {
          url: displayUrl,
          count: models.length
        })
      })
      toast({
        title: t("settings.providers.test_connection.success_title"),
        description: t(
          "settings.providers.test_connection.success_description",
          {
            name: activeConfig.name,
            url: displayUrl,
            count: models.length
          }
        ),
        variant: "default"
      })
    } catch (error: unknown) {
      logger.error("Connection test failed", "ProviderSettings", { error })
      const errorMessage = getDisplayErrorMessage(error, "Failed to connect")
      const shouldShowCspHint =
        errorMessage.toLowerCase().includes("failed to fetch") &&
        Boolean(cspCompatibilityHint)
      const failureMessage = t(
        "settings.providers.test_connection.inline_failed",
        {
          url: displayUrl,
          error: shouldShowCspHint
            ? `${errorMessage}. ${cspCompatibilityHint}`
            : errorMessage
        }
      )

      setConnectionStatus({ success: false, message: failureMessage })
      toast({
        title: t("settings.providers.test_connection.failed_title"),
        description: t(
          "settings.providers.test_connection.failed_description",
          {
            url: displayUrl,
            error: shouldShowCspHint
              ? `${errorMessage}. ${cspCompatibilityHint}`
              : errorMessage
          }
        ),
        variant: "destructive"
      })
    } finally {
      setTestingConnection(false)
    }
  }

  const handleSave = async (config: ProviderConfig) => {
    try {
      await ProviderManager.updateProviderConfig(config.id, config)
      setProviders((prev) => prev.map((p) => (p.id === config.id ? config : p)))
      setHasUnsavedChanges(false)
      toast({
        title: t("settings.saved"),
        description: `Configuration for ${config.name} saved.`
      })
    } catch (_error) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to save configuration."
      })
    }
  }

  const addProvider = async (input: {
    name: string
    baseUrl: string
    wire: CustomProviderWire
    apiKey?: string
    customModels?: string[]
  }): Promise<boolean> => {
    try {
      const config = await ProviderManager.addCustomProvider(input)
      await loadProviders()
      setSelectedId(String(config.id))
      toast({
        title: t("settings.providers.add.added_title"),
        description: t("settings.providers.add.added_description", {
          name: config.name
        })
      })
      return true
    } catch (error) {
      logger.error("Failed to add provider", "ProviderSettings", { error })
      toast({
        variant: "destructive",
        title: t("settings.providers.add.failed_title"),
        description: getDisplayErrorMessage(
          error,
          t("settings.providers.add.failed_title")
        )
      })
      return false
    }
  }

  const removeProvider = async (id: string) => {
    try {
      await ProviderManager.removeCustomProvider(id)
      await loadProviders()
      if (selectedId === id) setSelectedId(DEFAULT_PROVIDER_ID)
    } catch (error) {
      logger.error("Failed to remove provider", "ProviderSettings", { error })
      toast({
        variant: "destructive",
        title: t("settings.providers.add.remove_failed_title"),
        description: getDisplayErrorMessage(
          error,
          t("settings.providers.add.remove_failed_title")
        )
      })
    }
  }

  const updateConfig = (updates: Partial<ProviderConfig>) => {
    if (!activeConfig) return
    const updated = { ...activeConfig, ...updates }
    setProviders((prev) =>
      prev.map((p) => (p.id === activeConfig.id ? updated : p))
    )
    setHasUnsavedChanges(true)
    setConnectionStatus(null)
  }

  const setProviderEnabled = async (enabled: boolean) => {
    if (!activeConfig) return
    const updated = { ...activeConfig, enabled }
    setProviders((prev) =>
      prev.map((p) => (p.id === activeConfig.id ? updated : p))
    )
    try {
      await ProviderManager.updateProviderConfig(activeConfig.id, { enabled })
    } catch (error) {
      logger.error("Failed to auto-save toggle", "ProviderSettings", { error })
    }
  }

  useEffect(() => {
    if (!hasUnsavedChanges || !activeConfig) return

    const timeoutId = setTimeout(async () => {
      try {
        await ProviderManager.updateProviderConfig(
          activeConfig.id,
          activeConfig
        )
        setHasUnsavedChanges(false)
        logger.debug(
          `Auto-saved configuration for ${activeConfig.name}`,
          "ProviderSettings"
        )
      } catch (error) {
        logger.error("Auto-save failed", "ProviderSettings", { error })
      }
    }, 2000)

    return () => clearTimeout(timeoutId)
  }, [activeConfig, hasUnsavedChanges])

  const headerStatusConfigs = [
    {
      test: () => !activeConfig?.enabled,
      dot: "bg-muted-foreground/40 ring-muted-foreground/20",
      label: "inactive"
    },
    {
      test: () =>
        Boolean(
          activeConfig &&
            (connectionStatus?.success ??
              providerHealth[activeConfig.id]?.success)
        ),
      dot: "bg-status-success ring-status-success/30",
      label: "connected"
    },
    {
      test: () =>
        Boolean(
          activeConfig &&
            (connectionStatus?.success === false ||
              providerHealth[activeConfig.id]?.success === false)
        ),
      dot: "bg-status-danger ring-status-danger/30",
      label: "connection_failed"
    }
  ] as const
  const headerStatus = headerStatusConfigs.find((c) => c.test()) ?? {
    dot: "bg-status-warning ring-status-warning/30",
    label: "not_tested"
  }

  return {
    providers,
    loading,
    selectedId,
    setSelectedId,
    activeConfig,
    cspCompatibilityHint,
    isLocalProvider,
    isCustomProvider,
    isRemoteEndpoint,
    testingConnection,
    connectionStatus,
    hasUnsavedChanges,
    providerHealth,
    headerStatus,
    handleTestConnection,
    handleSave,
    updateConfig,
    setProviderEnabled,
    addProvider,
    removeProvider
  }
}
