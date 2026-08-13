import { useCallback, useEffect, useReducer, useRef } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "@/hooks/use-toast"
import { getDisplayErrorMessage } from "@/lib/error-display"
import { isAppError } from "@/lib/error-utils"
import { logger } from "@/lib/logger"
import type {
  CustomProviderWire,
  ProviderServiceProfile
} from "@/lib/providers/types"
import type {
  ProviderDraft,
  ProviderDraftUpdate
} from "../types/provider-draft"
import {
  initialProviderDraftState,
  providerDraftReducer
} from "./provider-draft-reducer"
import {
  addProviderDraft,
  loadProviderDrafts,
  removeProviderDraft,
  saveProviderDraft,
  testProviderConnection,
  updateProviderEnabled
} from "./provider-settings-commands"
import { deriveProviderSettingsView } from "./provider-settings-view"
import { useProviderHealth } from "./use-provider-health"

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
  // Toggle writes are serialized per provider. This map records the last
  // response proven authoritative, so a failed optimistic toggle never rolls
  // back to a value captured from another optimistic render.
  const storedEnabled = useRef(new Map<string, boolean>())
  const toggleQueues = useRef(new Map<string, Promise<void>>())
  const providerHealth = useProviderHealth(providers, savedRevision)

  const loadProviders = useCallback(async () => {
    dispatch({ type: "load-started" })
    try {
      const drafts = await loadProviderDrafts()
      for (const provider of drafts) {
        storedEnabled.current.set(String(provider.id), provider.enabled)
      }
      dispatch({
        type: "load-succeeded",
        providers: drafts
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

  const {
    activeConfig,
    cspCompatibilityHint,
    displayUrl,
    isCustomProvider,
    isLocalProvider,
    isRemoteEndpoint,
    headerStatus
  } = deriveProviderSettingsView({
    providers,
    selectedId,
    connectionStatus,
    providerHealth,
    defaultUrl: t("settings.providers.test_connection.default_url")
  })

  const handleTestConnection = async () => {
    if (!activeConfig) return

    logger.info("Testing connection with config", "ProviderSettings", {
      id: activeConfig.id,
      name: activeConfig.name,
      baseUrl: activeConfig.baseUrl,
      enabled: activeConfig.enabled
    })

    dispatch({ type: "connection-test-started" })

    try {
      const command = await testProviderConnection(activeConfig)
      if (command.kind === "api-key-required") {
        const message = t(
          "settings.providers.test_connection.api_key_required",
          { name: activeConfig.name }
        )
        dispatch({
          type: "connection-status-set",
          status: { success: false, message }
        })
        toast({
          title: t("settings.providers.test_connection.api_key_required_title"),
          description: message,
          variant: "destructive"
        })
        return
      }
      const { result } = command
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
        const savedDraft = await saveProviderDraft(config)
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
        storedEnabled.current.set(providerId, savedDraft.enabled)
        dispatch({
          type: "provider-saved",
          provider: savedDraft
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
    [t]
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
      const addedDraft = await addProviderDraft(input)
      // The mutation response is authoritative. Merge it into the current
      // client state instead of replacing every provider with a list snapshot
      // that may have started before another pending save completed.
      storedEnabled.current.set(String(addedDraft.id), addedDraft.enabled)
      dispatch({
        type: "provider-added",
        provider: addedDraft
      })
      toast({
        title: t("settings.providers.add.added_title"),
        description: t("settings.providers.add.added_description", {
          name: addedDraft.name
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
      await removeProviderDraft(id)
      // The mutation result is authoritative. Do not follow it with a full
      // list refresh: an older snapshot could overwrite concurrent edits or
      // reintroduce the removed provider locally.
      storedEnabled.current.delete(id)
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
    const toggleRevision = (configRevisions.current.get(providerId) ?? 0) + 1
    configRevisions.current.set(providerId, toggleRevision)
    dispatch({
      type: "provider-enabled-optimistically",
      providerId,
      enabled
    })
    const previousToggle = toggleQueues.current.get(providerId)
    const toggleOperation = (previousToggle ?? Promise.resolve())
      .catch(() => undefined)
      .then(async () => {
        try {
          const savedDraft = await updateProviderEnabled(providerId, enabled)
          storedEnabled.current.set(providerId, savedDraft.enabled)
          if (
            (configRevisions.current.get(providerId) ?? 0) !== toggleRevision
          ) {
            // Storage advanced, but a newer local intent owns the draft.
            dispatch({ type: "stored-provider-changed" })
            logger.debug(
              "Ignored stale provider toggle response",
              "ProviderSettings",
              { providerId }
            )
            return
          }
          dispatch({ type: "provider-saved", provider: savedDraft })
        } catch (error) {
          if (
            (configRevisions.current.get(providerId) ?? 0) !== toggleRevision
          ) {
            logger.debug(
              "Ignored stale provider toggle failure",
              "ProviderSettings",
              { providerId }
            )
            return
          }
          const authoritativeEnabled = storedEnabled.current.get(providerId)
          if (authoritativeEnabled !== undefined) {
            dispatch({
              type: "provider-enabled-reverted",
              providerId,
              enabled: authoritativeEnabled
            })
          }
          logger.error("Failed to auto-save toggle", "ProviderSettings", {
            error
          })
          toast({
            variant: "destructive",
            title: "Error",
            description: "Failed to update provider state."
          })
        }
      })
    toggleQueues.current.set(providerId, toggleOperation)
    await toggleOperation
    if (toggleQueues.current.get(providerId) === toggleOperation) {
      toggleQueues.current.delete(providerId)
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
