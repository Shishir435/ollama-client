import { useCallback, useEffect, useReducer, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "@/hooks/use-toast"
import { getDisplayErrorMessage } from "@/lib/error-display"
import { isAppError } from "@/lib/error-utils"
import { logger } from "@/lib/logger"
import {
  OLLAMA_CORS_COMMAND,
  OLLAMA_CORS_MESSAGE_KEY
} from "@/lib/onboarding/provider-connection"
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
  testProviderConnection
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
    savedRevision,
    saveStatus
  } = state
  /**
   * Incremented synchronously for every local edit. An RPC response may update
   * local state only when the provider still has the revision it started with.
   */
  const configRevisions = useRef(new Map<string, number>())
  const providerHealth = useProviderHealth(providers, savedRevision)

  const loadProviders = useCallback(async () => {
    dispatch({ type: "load-started" })
    try {
      const drafts = await loadProviderDrafts()
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
    isLocalNetworkEndpoint,
    headerStatus
  } = deriveProviderSettingsView({
    providers,
    selectedId,
    connectionStatus,
    providerHealth,
    defaultUrl: t("settings.providers.test_connection.default_url")
  })

  const [connectionFixCommand, setConnectionFixCommand] = useState<string>()

  const setConnectionFailure = (message: string): void => {
    dispatch({
      type: "connection-status-set",
      status: { success: false, message }
    })
  }

  const handleApiKeyRequired = (name: string): void => {
    const message = t("settings.providers.test_connection.api_key_required", {
      name
    })
    setConnectionFailure(message)
  }

  const handleEmptyModelCatalog = (
    modelListSupported: boolean | undefined
  ): void => {
    const noModelList = modelListSupported === false
    setConnectionFailure(
      t(
        noModelList
          ? "settings.providers.test_connection.inline_no_model_list"
          : "settings.providers.test_connection.inline_no_models",
        { url: displayUrl }
      )
    )
  }

  const handleConnectionSuccess = (
    name: string,
    result: { modelCount: number; modelListSupported?: boolean }
  ): void => {
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
  }

  /**
   * A failed test is shown once, inline beside the form, in the words the
   * background classified it with. A toast would only repeat it, and the raw
   * browser error ("Failed to fetch") names nothing the user can change.
   */
  const handleConnectionFailure = (error: unknown): void => {
    logger.error("Connection test failed", "ProviderSettings", { error })
    const classified = isAppError(error) && error.messageKey
    const errorMessage = classified
      ? t(error.messageKey as string, error.messageParams)
      : getDisplayErrorMessage(
          error,
          t("settings.providers.test_connection.failed_fallback", {
            url: displayUrl
          })
        )
    const unreachable =
      isAppError(error) &&
      error.messageKey === "onboarding.provider.errors.unavailable"
    setConnectionFixCommand(
      isAppError(error) && error.messageKey === OLLAMA_CORS_MESSAGE_KEY
        ? OLLAMA_CORS_COMMAND
        : undefined
    )
    setConnectionFailure(
      unreachable && cspCompatibilityHint
        ? `${errorMessage} ${cspCompatibilityHint}`
        : errorMessage
    )
  }

  const handleTestConnection = async () => {
    if (!activeConfig) return
    logger.info("Testing connection with config", "ProviderSettings", {
      id: activeConfig.id,
      name: activeConfig.name,
      baseUrl: activeConfig.baseUrl,
      enabled: activeConfig.enabled
    })
    dispatch({ type: "connection-test-started" })
    setConnectionFixCommand(undefined)
    try {
      const command = await testProviderConnection(activeConfig)
      if (command.kind === "api-key-required") {
        handleApiKeyRequired(activeConfig.name)
        return
      }
      const { result } = command
      logger.debug("Provider connection RPC succeeded", "ProviderSettings", {
        count: result.modelCount
      })
      if (result.modelCount === 0) {
        handleEmptyModelCatalog(result.modelListSupported)
        return
      }
      handleConnectionSuccess(activeConfig.name, result)
    } catch (error: unknown) {
      handleConnectionFailure(error)
    } finally {
      dispatch({ type: "connection-test-finished" })
    }
  }

  const persistConfig = useCallback(
    async (config: ProviderDraft): Promise<boolean> => {
      const providerId = String(config.id)
      const startedRevision = configRevisions.current.get(providerId) ?? 0
      dispatch({ type: "save-started" })
      try {
        const savedDraft = await saveProviderDraft(config)
        const preserveDraft =
          (configRevisions.current.get(providerId) ?? 0) !== startedRevision
        dispatch({
          type: "provider-saved",
          provider: savedDraft,
          preserveDraft
        })
        if (preserveDraft) return false
        return true
      } catch (error) {
        logger.error(
          "Failed to save provider configuration",
          "ProviderSettings",
          {
            error
          }
        )
        dispatch({ type: "save-failed" })
        toast({
          variant: "destructive",
          title: t("settings.providers.save_failed_title", {
            name: config.name
          }),
          description: t("settings.providers.save_failed_description")
        })
        return false
      }
    },
    [t]
  )

  const setSelectedId = useCallback(
    (nextId: string, afterResolvingDraft = false): boolean => {
      if (nextId === selectedId) return true
      /**
       * A dirty draft is never persisted as a side effect of navigating; the
       * caller asks the user to save or discard first.
       */
      if (hasUnsavedChanges && !afterResolvingDraft) return false
      dispatch({ type: "provider-selected", providerId: nextId })
      return true
    },
    [hasUnsavedChanges, selectedId]
  )

  const handleSave = async (config: ProviderDraft): Promise<boolean> =>
    persistConfig(config)

  const addProvider = async (input: {
    name: string
    baseUrl: string
    wire: CustomProviderWire
    apiKey?: string
    customModels?: string[]
    serviceProfile?: ProviderServiceProfile
  }): Promise<boolean> => {
    if (hasUnsavedChanges) return false
    try {
      const addedDraft = await addProviderDraft(input)
      /**
       * The mutation response is authoritative. Merge it into the current
       * client state instead of replacing every provider with a list snapshot
       * that may have started before another pending save completed.
       */
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
      /**
       * The mutation result is authoritative. Do not follow it with a full
       * list refresh: an older snapshot could overwrite concurrent edits or
       * reintroduce the removed provider locally.
       */
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

  /**
   * Manual model ids are a draft like every other connection field: committed
   * by the Save bar, never by a side effect that would also commit an unsaved
   * URL or key edit.
   */
  const setCustomModels = (customModels: string[]): void => {
    updateConfig({ customModels })
  }

  const setProviderEnabled = (enabled: boolean): void => {
    updateConfig({ enabled })
  }

  const discardChanges = (): void => {
    if (!activeConfig) return
    const providerId = String(activeConfig.id)
    configRevisions.current.set(
      providerId,
      (configRevisions.current.get(providerId) ?? 0) + 1
    )
    setConnectionFixCommand(undefined)
    dispatch({ type: "draft-discarded", providerId })
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
    isLocalNetworkEndpoint,
    testingConnection,
    connectionStatus,
    connectionFixCommand: connectionStatus?.success
      ? undefined
      : connectionFixCommand,
    hasUnsavedChanges,
    saveStatus,
    discardChanges,
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
