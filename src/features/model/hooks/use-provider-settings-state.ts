import type { ProviderDraftInput } from "@ollama-client/contracts/provider-rpc"
import { RpcMethod } from "@ollama-client/contracts/rpc"
import { useCallback, useEffect, useReducer, useRef } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "@/hooks/use-toast"
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
  ProviderId,
  type ProviderServiceProfile
} from "@/lib/providers/types"
import { extensionRpcClient } from "@/protocol/extension-client"
import {
  type ProviderDraft,
  type ProviderDraftUpdate,
  providerDraftFromPublic,
  providerDraftHasUsableApiKey
} from "../types/provider-draft"
import {
  initialProviderDraftState,
  providerDraftReducer
} from "./provider-draft-reducer"
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
  const [state, dispatch] = useReducer(
    providerDraftReducer,
    initialProviderDraftState
  )
  const {
    providers,
    loading,
    selectedId,
    testingConnection,
    connectionStatus,
    hasUnsavedChanges,
    savedRevision
  } = state
  // Incremented synchronously for every local edit. An RPC response may update
  // local state only when the provider still has the revision it started with.
  const configRevisions = useRef(new Map<string, number>())
  const providerHealth = useProviderHealth(providers, savedRevision)

  const loadProviders = useCallback(async () => {
    dispatch({ type: "load-started" })
    try {
      const { providers: data } = await extensionRpcClient.call(
        RpcMethod.ProvidersList,
        {}
      )
      dispatch({
        type: "load-succeeded",
        providers: data.map(providerDraftFromPublic)
      })
    } catch (error) {
      logger.error("Failed to load providers", "ProviderSettings", { error })
    } finally {
      dispatch({ type: "load-finished" })
    }
  }, [])

  useEffect(() => {
    loadProviders()
  }, [loadProviders])

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
  const configForRpc = useCallback(
    (config: ProviderDraft): ProviderDraftInput => ({
      id: String(config.id),
      type: config.type,
      enabled: config.enabled,
      name: config.name,
      apiKey: config.apiKey,
      ...(config.baseUrl !== undefined ? { baseUrl: config.baseUrl } : {}),
      ...(config.modelId !== undefined ? { modelId: config.modelId } : {}),
      ...(config.customModels !== undefined
        ? { customModels: config.customModels }
        : {}),
      ...(config.serviceProfile !== undefined
        ? { serviceProfile: config.serviceProfile }
        : {}),
      ...(config.compatibility !== undefined
        ? { compatibility: config.compatibility }
        : {})
    }),
    []
  )

  const handleTestConnection = async () => {
    if (!activeConfig) return

    logger.info("Testing connection with config", "ProviderSettings", {
      id: activeConfig.id,
      name: activeConfig.name,
      baseUrl: activeConfig.baseUrl,
      enabled: activeConfig.enabled
    })

    dispatch({ type: "connection-test-started" })

    // Custom endpoints may be keyless local/LAN servers — never require a key
    // for them; a real 401 from the test surfaces its own error.
    if (
      providerProfileRequiresApiKey(
        resolveProviderServiceProfile(activeConfig)
      ) &&
      !providerDraftHasUsableApiKey(activeConfig)
    ) {
      const message = t("settings.providers.test_connection.api_key_required", {
        name: activeConfig.name
      })

      dispatch({
        type: "connection-status-set",
        status: { success: false, message }
      })
      toast({
        title: t("settings.providers.test_connection.api_key_required_title"),
        description: message,
        variant: "destructive"
      })
      dispatch({ type: "connection-test-finished" })
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
        // A server without a catalog endpoint is reachable but has nothing to
        // offer until the user names a model, so say that instead of repeating
        // "no models were returned" at someone who cannot make it return any.
        const noModelList = result.modelListSupported === false
        dispatch({
          type: "connection-status-set",
          status: {
            success: false,
            message: t(
              noModelList
                ? "settings.providers.test_connection.inline_no_model_list"
                : "settings.providers.test_connection.inline_no_models",
              { url: displayUrl }
            )
          }
        })
        toast({
          title: t(
            noModelList
              ? "settings.providers.test_connection.no_model_list_title"
              : "settings.providers.test_connection.no_models_title"
          ),
          description: t(
            noModelList
              ? "settings.providers.test_connection.no_model_list_description"
              : "settings.providers.test_connection.no_models_description",
            { url: displayUrl }
          ),
          variant: "destructive"
        })
        return
      }

      const manualOnly = result.modelListSupported === false
      dispatch({
        type: "connection-status-set",
        status: {
          success: true,
          message: t(
            manualOnly
              ? "settings.providers.test_connection.inline_success_manual"
              : "settings.providers.test_connection.inline_success",
            { url: displayUrl, count: result.modelCount }
          )
        }
      })
      toast({
        title: t("settings.providers.test_connection.success_title"),
        description: t(
          manualOnly
            ? "settings.providers.test_connection.success_description_manual"
            : "settings.providers.test_connection.success_description",
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

      dispatch({
        type: "connection-status-set",
        status: { success: false, message: failureMessage }
      })
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
      dispatch({ type: "connection-test-finished" })
    }
  }

  const persistConfig = useCallback(
    async (
      config: ProviderDraft,
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
        dispatch({
          type: "provider-saved",
          provider: providerDraftFromPublic(saved)
        })
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
      dispatch({ type: "provider-selected", providerId: nextId })
    },
    [activeConfig, hasUnsavedChanges, persistConfig, selectedId]
  )

  const handleSave = async (config: ProviderDraft) => {
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
      dispatch({
        type: "provider-added",
        provider: providerDraftFromPublic(config)
      })
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
      dispatch({ type: "provider-removed", providerId: id })
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

  const updateConfig = (updates: ProviderDraftUpdate) => {
    if (!activeConfig) return
    const providerId = String(activeConfig.id)
    configRevisions.current.set(
      providerId,
      (configRevisions.current.get(providerId) ?? 0) + 1
    )
    dispatch({ type: "draft-updated", providerId, updates })
  }

  const setCustomModels = async (customModels: string[]): Promise<void> => {
    if (!activeConfig) return

    const updated = { ...activeConfig, customModels }
    updateConfig({ customModels })

    // Manual ids are part of model discovery input. Persist them immediately
    // so another extension page opening the model menu cannot race the generic
    // form debounce and observe an enabled provider with no usable models.
    await persistConfig(updated, false, false)
  }

  const setProviderEnabled = async (enabled: boolean) => {
    if (!activeConfig) return
    if (
      hasUnsavedChanges &&
      !(await persistConfig(activeConfig, false, false))
    ) {
      return
    }

    const providerId = String(activeConfig.id)
    configRevisions.current.set(
      providerId,
      (configRevisions.current.get(providerId) ?? 0) + 1
    )
    dispatch({
      type: "provider-enabled-optimistically",
      providerId,
      enabled
    })
    try {
      const { provider: saved } = await extensionRpcClient.call(
        RpcMethod.ProvidersSetEnabled,
        {
          providerId,
          enabled
        }
      )
      dispatch({
        type: "provider-saved",
        provider: providerDraftFromPublic(saved)
      })
    } catch (error) {
      dispatch({
        type: "provider-enabled-reverted",
        providerId,
        enabled: activeConfig.enabled
      })
      logger.error("Failed to auto-save toggle", "ProviderSettings", { error })
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to update provider state."
      })
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
    /*
     * An endpoint with no catalog is never asked for one after the first
     * answer, so the background check reaches nothing and cannot claim a live
     * connection. Say what is actually true — this provider runs on the model
     * IDs you declared — rather than showing a red dot at a working provider,
     * or a green one for a round trip nobody made.
     *
     * Ahead of "connected" on purpose: the background check reports a model
     * count for the ids the user declared, and that count is what "connected"
     * reads. An explicit test did reach the endpoint, so it still wins — this
     * rule stands down as soon as there is one.
     */
    {
      test: () =>
        Boolean(
          activeConfig &&
            connectionStatus === null &&
            providerHealth[activeConfig.id]?.modelListSupported === false
        ),
      dot: "bg-status-warning ring-status-warning/30",
      label: "manual_models"
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
    setCustomModels,
    setProviderEnabled,
    addProvider,
    removeProvider
  }
}
