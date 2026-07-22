import { useCallback, useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "@/hooks/use-toast"
import { DEFAULT_PROVIDER_ID } from "@/lib/constants"
import { getDisplayErrorMessage } from "@/lib/error-display"
import { isAppError } from "@/lib/error-utils"
import { logger } from "@/lib/logger"
import {
  providerProfileRequiresApiKey,
  resolveProviderServiceProfile
} from "@/lib/providers/service-profile"
import {
  type CustomProviderWire,
  isCustomProviderId,
  type ProviderConfig,
  ProviderId,
  type ProviderServiceProfile
} from "@/lib/providers/types"
import { extensionRpcClient } from "@/protocol/extension-client"
import type { PublicProviderConfig } from "@/protocol/provider-rpc"
import { RpcMethod } from "@/protocol/rpc"
import { useProviderHealth } from "./use-provider-health"

const LOCAL_PROVIDER_IDS = [
  ProviderId.OLLAMA,
  ProviderId.LM_STUDIO,
  ProviderId.LLAMA_CPP
]

type ProviderSettingsConfig = ProviderConfig & {
  hasApiKey?: boolean
}

const toSettingsConfig = (
  provider: PublicProviderConfig
): ProviderSettingsConfig => provider as unknown as ProviderSettingsConfig

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
  const [providers, setProviders] = useState<ProviderSettingsConfig[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedIdState] = useState<string>(DEFAULT_PROVIDER_ID)
  const [testingConnection, setTestingConnection] = useState(false)
  const [connectionStatus, setConnectionStatus] = useState<{
    success: boolean
    message: string
  } | null>(null)
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  const [apiKeyEditedProviderIds, setApiKeyEditedProviderIds] = useState<
    Set<string>
  >(new Set())
  // Incremented synchronously for every local edit. An RPC response may update
  // local state only when the provider still has the revision it started with.
  const configRevisions = useRef(new Map<string, number>())

  const providerHealth = useProviderHealth(providers)

  const loadProviders = useCallback(async () => {
    setLoading(true)
    try {
      const { providers: data } = await extensionRpcClient.call(
        RpcMethod.ProvidersList,
        {}
      )
      setProviders(data.map(toSettingsConfig))
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
  const apiKeyWasEdited = activeConfig
    ? apiKeyEditedProviderIds.has(String(activeConfig.id))
    : false

  const configForRpc = useCallback(
    (config: ProviderSettingsConfig): ProviderConfig => {
      const { hasApiKey: _hasApiKey, ...withoutPublicMarker } = config
      if (apiKeyEditedProviderIds.has(String(config.id))) {
        return withoutPublicMarker
      }
      const { apiKey: _apiKey, ...publicConfig } = withoutPublicMarker
      return publicConfig as ProviderConfig
    },
    [apiKeyEditedProviderIds]
  )

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
      providerProfileRequiresApiKey(
        resolveProviderServiceProfile(activeConfig)
      ) &&
      !activeConfig.apiKey?.trim() &&
      (!activeConfig.hasApiKey || apiKeyWasEdited)
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
      const result = await extensionRpcClient.call(
        RpcMethod.ProvidersTestConnection,
        { target: "draft", config: configForRpc(activeConfig) }
      )
      logger.debug("Provider connection RPC succeeded", "ProviderSettings", {
        count: result.modelCount
      })

      if (result.modelCount === 0) {
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
          count: result.modelCount
        })
      })
      toast({
        title: t("settings.providers.test_connection.success_title"),
        description: t(
          "settings.providers.test_connection.success_description",
          {
            name: activeConfig.name,
            url: displayUrl,
            count: result.modelCount
          }
        ),
        variant: "default"
      })
    } catch (error: unknown) {
      logger.error("Connection test failed", "ProviderSettings", { error })
      const errorMessage =
        isAppError(error) && error.messageKey
          ? t(error.messageKey, error.messageParams)
          : getDisplayErrorMessage(error, "Failed to connect")
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

  const persistConfig = useCallback(
    async (
      config: ProviderSettingsConfig,
      showSuccessToast = true,
      showErrorToast = true
    ): Promise<boolean> => {
      const providerId = String(config.id)
      const startedRevision = configRevisions.current.get(providerId) ?? 0
      try {
        const { provider: saved } = await extensionRpcClient.call(
          RpcMethod.ProvidersUpsert,
          {
            target: "existing",
            config: configForRpc(config)
          }
        )
        if (
          (configRevisions.current.get(providerId) ?? 0) !== startedRevision
        ) {
          logger.debug(
            "Ignored stale provider save response",
            "ProviderSettings",
            { providerId }
          )
          return false
        }
        setProviders((prev) =>
          prev.map((provider) =>
            provider.id === config.id ? toSettingsConfig(saved) : provider
          )
        )
        setApiKeyEditedProviderIds((previous) => {
          const next = new Set(previous)
          next.delete(providerId)
          return next
        })
        setHasUnsavedChanges(false)
        if (showSuccessToast) {
          toast({
            title: t("settings.saved"),
            description: `Configuration for ${config.name} saved.`
          })
        }
        return true
      } catch (error) {
        logger.error(
          "Failed to save provider configuration",
          "ProviderSettings",
          {
            error
          }
        )
        if (showErrorToast) {
          toast({
            variant: "destructive",
            title: "Error",
            description: "Failed to save configuration."
          })
        }
        return false
      }
    },
    [configForRpc, t]
  )

  const setSelectedId = useCallback(
    async (nextId: string): Promise<void> => {
      if (nextId === selectedId) return
      if (
        hasUnsavedChanges &&
        activeConfig &&
        !(await persistConfig(activeConfig, false))
      ) {
        return
      }
      setSelectedIdState(nextId)
    },
    [activeConfig, hasUnsavedChanges, persistConfig, selectedId]
  )

  const handleSave = async (config: ProviderConfig) => {
    await persistConfig(config, true)
  }

  const addProvider = async (input: {
    name: string
    baseUrl: string
    wire: CustomProviderWire
    apiKey?: string
    customModels?: string[]
    serviceProfile?: ProviderServiceProfile
  }): Promise<boolean> => {
    if (
      hasUnsavedChanges &&
      activeConfig &&
      !(await persistConfig(activeConfig, false))
    ) {
      return false
    }
    try {
      const { provider: config } = await extensionRpcClient.call(
        RpcMethod.ProvidersUpsert,
        { target: "new", provider: input }
      )
      // The mutation response is authoritative. Merge it into the current
      // client state instead of replacing every provider with a list snapshot
      // that may have started before another pending save completed.
      setProviders((current) => [
        ...current.filter((provider) => provider.id !== config.id),
        toSettingsConfig(config)
      ])
      setSelectedIdState(String(config.id))
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

  const removeProvider = async (id: string): Promise<boolean> => {
    const providerName = providers.find(
      (provider) => String(provider.id) === id
    )?.name
    try {
      await extensionRpcClient.call(RpcMethod.ProvidersRemove, {
        providerId: id
      })
      // The mutation result is authoritative. Do not follow it with a full
      // list refresh: an older snapshot could overwrite concurrent edits or
      // reintroduce the removed provider locally.
      setProviders((current) =>
        current.filter((provider) => String(provider.id) !== id)
      )
      if (selectedId === id) setSelectedIdState(DEFAULT_PROVIDER_ID)
      toast({
        title: t("settings.providers.add.removed_title"),
        description: t("settings.providers.add.removed_description", {
          name: providerName ?? id
        })
      })
      return true
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
      return false
    }
  }

  const updateConfig = (updates: Partial<ProviderConfig>) => {
    if (!activeConfig) return
    const providerId = String(activeConfig.id)
    configRevisions.current.set(
      providerId,
      (configRevisions.current.get(providerId) ?? 0) + 1
    )
    if (Object.hasOwn(updates, "apiKey")) {
      setApiKeyEditedProviderIds((previous) =>
        new Set(previous).add(String(activeConfig.id))
      )
    }
    const updated = { ...activeConfig, ...updates }
    setProviders((prev) =>
      prev.map((p) => (p.id === activeConfig.id ? updated : p))
    )
    setHasUnsavedChanges(true)
    setConnectionStatus(null)
  }

  const setProviderEnabled = async (enabled: boolean) => {
    if (!activeConfig) return
    const providerId = String(activeConfig.id)
    configRevisions.current.set(
      providerId,
      (configRevisions.current.get(providerId) ?? 0) + 1
    )
    const updated = { ...activeConfig, enabled }
    setProviders((prev) =>
      prev.map((p) => (p.id === activeConfig.id ? updated : p))
    )
    try {
      await extensionRpcClient.call(RpcMethod.ProvidersUpsert, {
        target: "existing",
        config: configForRpc(updated)
      })
    } catch (error) {
      logger.error("Failed to auto-save toggle", "ProviderSettings", { error })
    }
  }

  useEffect(() => {
    if (!hasUnsavedChanges || !activeConfig) return

    const timeoutId = setTimeout(async () => {
      if (await persistConfig(activeConfig, false, false)) {
        logger.debug(
          `Auto-saved configuration for ${activeConfig.name}`,
          "ProviderSettings"
        )
      }
    }, 2000)

    return () => clearTimeout(timeoutId)
  }, [activeConfig, hasUnsavedChanges, persistConfig])

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
