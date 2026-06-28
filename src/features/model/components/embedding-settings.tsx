import { useStorage } from "@plasmohq/storage/hook"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { SectionStack, TwoColumnGrid } from "@/components/layout"
import { ConfirmActionDialog, StatusAlert } from "@/components/settings"
import { FeedbackSettings } from "@/features/knowledge/components/feedback-settings"
import { useEmbeddingDimensionStats } from "@/features/model/hooks/use-embedding-dimension-stats"
import { useEmbeddingModelCheck } from "@/features/model/hooks/use-embedding-model-check"
import { useEmbeddingRebuild } from "@/features/model/hooks/use-embedding-rebuild"
import { useProviderModels } from "@/features/model/hooks/use-provider-models"
import { useConfirmAction } from "@/hooks/use-confirm-action"
import { useToast } from "@/hooks/use-toast"
import {
  DEFAULT_EMBEDDING_CONFIG,
  DEFAULT_EMBEDDING_MODEL,
  DEFAULT_PROVIDER_ID,
  type EmbeddingConfig,
  STORAGE_KEYS
} from "@/lib/constants"
import { getCacheStats } from "@/lib/embeddings/embedding-client"
import {
  isLikelyEmbeddingModelName,
  recommendedEmbeddingBaseSet
} from "@/lib/embeddings/model-name-filter"
import {
  clearAllVectors,
  getStorageStats,
  removeDuplicateVectors
} from "@/lib/embeddings/vector-store"
import { logger } from "@/lib/logger"
import { AlertTriangle, RefreshCw } from "@/lib/lucide-icon"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"

import { DatabaseManagementCard } from "./embedding-config/database-management-card"
import { EmbeddingGenerationConfig } from "./embedding-config/embedding-generation-config"
import { EmbeddingHealthAlert } from "./embedding-config/embedding-health-alert"
import { EmbeddingLimitsConfig } from "./embedding-config/embedding-limits-config"
import { EmbeddingModelSelector } from "./embedding-config/embedding-model-selector"
import { EmbeddingRebuildDialogs } from "./embedding-config/embedding-rebuild-dialogs"
import { EmbeddingTestGeneration } from "./embedding-config/embedding-test-generation"
import { EmbeddingTestSearch } from "./embedding-config/embedding-test-search"
import { StorageStatsCard } from "./embedding-config/storage-stats-card"
import { EmbeddingIndexControls } from "./embedding-index-controls"

/**
 * Orchestrator for the Embeddings settings screen.
 *
 * Owns the high-level wiring between storage-backed state
 * (`selectedModel`, `config`) and the three extracted hooks:
 *
 *   - `useEmbeddingDimensionStats` — refreshable vector-store stats.
 *   - `useEmbeddingRebuild`        — the wipe + re-embed flow.
 *   - `useEmbeddingModelCheck`     — periodic background check + auto-switch.
 *
 * Renders four presentational sub-components plus four siblings
 * (`EmbeddingTestGeneration`, `EmbeddingTestSearch`, `EmbeddingGenerationConfig`,
 * `FeedbackSettings`, `DataMigrationSettings`).
 */
export const EmbeddingSettings = () => {
  const { t } = useTranslation()
  const { toast } = useToast()

  const [selectedModel, setSelectedModel] = useStorage<string>(
    {
      key: STORAGE_KEYS.EMBEDDINGS.SELECTED_MODEL,
      instance: plasmoGlobalStorage
    },
    DEFAULT_EMBEDDING_MODEL
  )
  const [config, setConfig] = useStorage<EmbeddingConfig>(
    {
      key: STORAGE_KEYS.EMBEDDINGS.CONFIG,
      instance: plasmoGlobalStorage
    },
    DEFAULT_EMBEDDING_CONFIG
  )
  const [memoryEnabled] = useStorage<boolean>(
    {
      key: STORAGE_KEYS.MEMORY.ENABLED,
      instance: plasmoGlobalStorage
    },
    true
  )

  const { models } = useProviderModels()

  // Keep `selectedModel` and `config.sharedEmbeddingModel` in sync if
  // the latter is the more-authoritative value (e.g. just set via the
  // model picker).
  useEffect(() => {
    if (
      config?.sharedEmbeddingModel &&
      config.sharedEmbeddingModel !== selectedModel
    ) {
      setSelectedModel(config.sharedEmbeddingModel)
    }
  }, [config?.sharedEmbeddingModel, selectedModel, setSelectedModel])

  const embeddingModels = useMemo(
    () => models.filter((model) => isLikelyEmbeddingModelName(model.name)),
    [models]
  )
  const hasAdvancedModels = useMemo(
    () =>
      embeddingModels.some(
        (model) =>
          !recommendedEmbeddingBaseSet.has(
            model.name.toLowerCase().split(":")[0]
          )
      ),
    [embeddingModels]
  )

  const updateConfig = useCallback(
    (updates: Partial<EmbeddingConfig>) => {
      setConfig((prev) => ({
        ...DEFAULT_EMBEDDING_CONFIG,
        ...prev,
        ...updates
      }))
    },
    [setConfig]
  )

  const resolveProviderForModel = useCallback(
    (modelName: string) => {
      const match = models.find((model) => model.name === modelName)
      return match?.providerId || DEFAULT_PROVIDER_ID
    },
    [models]
  )

  const applyModelChange = useCallback(
    (model: string, providerId: string) => {
      setSelectedModel(model)
      updateConfig({
        sharedEmbeddingModel: model,
        sharedEmbeddingProviderId: providerId
      })
    },
    [setSelectedModel, updateConfig]
  )

  const { stats: dimensionStats, refresh: refreshDimensionStats } =
    useEmbeddingDimensionStats()

  const {
    isRebuilding,
    progress: rebuildProgress,
    error: rebuildError,
    complete: rebuildComplete,
    rebuild
  } = useEmbeddingRebuild({
    memoryEnabled,
    onStoreChanged: refreshDimensionStats
  })

  const modelExists = useEmbeddingModelCheck({
    selectedModel,
    setSelectedModel,
    applyModelChange,
    embeddingModels,
    resolveProviderForModel
  })

  // Vector-store stats + maintenance, relocated here from the Context tab so
  // every embedding/vector-DB control lives on one screen. Dimension stats
  // come from `useEmbeddingDimensionStats`; storage/cache totals are loaded
  // locally and refreshed after any destructive action.
  const [storageStats, setStorageStats] = useState<{
    totalVectors: number
    totalSizeMB: number
    byType: Record<string, number>
  } | null>(null)
  const [cacheStats, setCacheStats] = useState<{
    size: number
    maxSize: number
  } | null>(null)
  const [isCleaning, setIsCleaning] = useState(false)
  const [confirmAction, setConfirmAction] = useState<
    "removeDuplicates" | "clearChat" | "clearAll" | null
  >(null)
  const confirmDialog = useConfirmAction()
  const isLoadingStatsRef = useRef(false)

  const loadStorageStats = useCallback(async () => {
    if (isLoadingStatsRef.current) return
    isLoadingStatsRef.current = true
    try {
      const [statsResult] = await Promise.allSettled([getStorageStats()])
      if (statsResult.status === "fulfilled") setStorageStats(statsResult.value)
      setCacheStats(getCacheStats())
    } catch (error) {
      logger.error("Failed to load storage stats", "EmbeddingSettings", {
        error
      })
    } finally {
      isLoadingStatsRef.current = false
    }
  }, [])

  useEffect(() => {
    loadStorageStats()
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") loadStorageStats()
    }, 10000)
    return () => clearInterval(interval)
  }, [loadStorageStats])

  const refreshAfterMaintenance = useCallback(async () => {
    await Promise.all([loadStorageStats(), refreshDimensionStats()])
  }, [loadStorageStats, refreshDimensionStats])

  const handleRemoveDuplicates = useCallback(async () => {
    setIsCleaning(true)
    try {
      const { deleted, kept } = await removeDuplicateVectors()
      toast({
        title: t(
          "model.embedding_config.database_management.remove_duplicates_success",
          { deleted, kept }
        )
      })
      await refreshAfterMaintenance()
    } catch (error) {
      logger.error("Failed to remove duplicates", "EmbeddingSettings", {
        error
      })
      toast({
        title: t(
          "model.embedding_config.database_management.remove_duplicates_error"
        ),
        variant: "destructive"
      })
    } finally {
      setIsCleaning(false)
    }
  }, [refreshAfterMaintenance, t, toast])

  const handleClearChatVectors = useCallback(async () => {
    setIsCleaning(true)
    try {
      const deleted = await clearAllVectors("chat")
      toast({
        title: t(
          "model.embedding_config.database_management.clear_chat_success",
          { count: deleted }
        )
      })
      await refreshAfterMaintenance()
    } catch (error) {
      logger.error("Failed to clear chat vectors", "EmbeddingSettings", {
        error
      })
      toast({
        title: t("model.embedding_config.database_management.clear_chat_error"),
        variant: "destructive"
      })
    } finally {
      setIsCleaning(false)
    }
  }, [refreshAfterMaintenance, t, toast])

  const handleClearAllVectors = useCallback(async () => {
    setIsCleaning(true)
    try {
      await clearAllVectors()
      toast({
        title: t("model.embedding_config.database_management.clear_all_success")
      })
      await refreshAfterMaintenance()
    } catch (error) {
      logger.error("Failed to clear all vectors", "EmbeddingSettings", {
        error
      })
      toast({
        title: t("model.embedding_config.database_management.clear_all_error"),
        variant: "destructive"
      })
    } finally {
      setIsCleaning(false)
    }
  }, [refreshAfterMaintenance, t, toast])

  const openConfirm = useCallback(
    (action: "removeDuplicates" | "clearChat" | "clearAll") => {
      setConfirmAction(action)
      confirmDialog.openDialog()
    },
    [confirmDialog]
  )

  const closeConfirm = useCallback(() => {
    confirmDialog.closeDialog()
    setConfirmAction(null)
  }, [confirmDialog])

  const confirmConfig = (() => {
    switch (confirmAction) {
      case "removeDuplicates":
        return {
          title: t(
            "model.embedding_config.database_management.remove_duplicates_confirm"
          ),
          confirmLabel: t("model.embedding_config.remove_duplicates_button"),
          onConfirm: handleRemoveDuplicates
        }
      case "clearChat":
        return {
          title: t(
            "model.embedding_config.database_management.clear_chat_confirm"
          ),
          confirmLabel: t("model.embedding_config.clear_chat_button"),
          onConfirm: handleClearChatVectors
        }
      case "clearAll":
        return {
          title: t(
            "model.embedding_config.database_management.clear_all_confirm"
          ),
          confirmLabel: t("model.embedding_config.clear_all_button"),
          onConfirm: handleClearAllVectors
        }
      default:
        return null
    }
  })()

  // Dialog open-state lives here so it can drive the dialog component.
  const [confirmRebuildOpen, setConfirmRebuildOpen] = useState(false)
  const [modelChangeOpen, setModelChangeOpen] = useState(false)
  const [pendingModel, setPendingModel] = useState<{
    model: string
    providerId: string
  } | null>(null)

  const handleModelSelected = useCallback(
    (model: string, providerId: string) => {
      setPendingModel({ model, providerId })
      setModelChangeOpen(true)
    },
    []
  )

  const handleSwitchOnly = useCallback(() => {
    if (!pendingModel) return
    applyModelChange(pendingModel.model, pendingModel.providerId)
    setPendingModel(null)
    setModelChangeOpen(false)
  }, [applyModelChange, pendingModel])

  const handleSwitchAndRebuild = useCallback(async () => {
    if (!pendingModel) return
    applyModelChange(pendingModel.model, pendingModel.providerId)
    setPendingModel(null)
    setModelChangeOpen(false)
    await rebuild()
  }, [applyModelChange, pendingModel, rebuild])

  const handleToggleShowAdvanced = useCallback(
    (checked: boolean) =>
      updateConfig({ showAdvancedEmbeddingModels: checked }),
    [updateConfig]
  )

  return (
    <SectionStack>
      <EmbeddingHealthAlert
        stats={dimensionStats}
        memoryEnabled={memoryEnabled}
        isRebuilding={isRebuilding}
        rebuildProgress={rebuildProgress}
        onRebuildRequest={() => setConfirmRebuildOpen(true)}
      />
      {rebuildError && (
        <StatusAlert
          variant="destructive"
          icon={AlertTriangle}
          title={t("settings.context.embedding_health.error")}
          description={rebuildError}
        />
      )}
      {rebuildComplete && (
        <StatusAlert
          variant="success"
          icon={RefreshCw}
          title={t("settings.context.embedding_health.success")}
        />
      )}
      <EmbeddingModelSelector
        selectedModel={selectedModel}
        config={config || DEFAULT_EMBEDDING_CONFIG}
        embeddingModels={embeddingModels}
        hasAdvancedModels={hasAdvancedModels}
        isRebuilding={isRebuilding}
        rebuildProgress={rebuildProgress}
        resolveProviderForModel={resolveProviderForModel}
        onModelSelected={handleModelSelected}
        onToggleShowAdvanced={handleToggleShowAdvanced}
      />
      <EmbeddingTestGeneration modelExists={modelExists} />
      <EmbeddingTestSearch modelExists={modelExists} />
      <EmbeddingGenerationConfig
        config={config || DEFAULT_EMBEDDING_CONFIG}
        updateConfig={updateConfig}
      />
      {storageStats && (
        <StorageStatsCard storageStats={storageStats} cacheStats={cacheStats} />
      )}
      <TwoColumnGrid>
        <DatabaseManagementCard
          onRemoveDuplicates={() => openConfirm("removeDuplicates")}
          onClearChat={() => openConfirm("clearChat")}
          onClearAll={() => openConfirm("clearAll")}
          isCleaning={isCleaning || isRebuilding}
          hasVectors={!!storageStats?.totalVectors}
          hasChatVectors={!!storageStats?.byType?.chat}
        />
        <EmbeddingLimitsConfig
          config={config || DEFAULT_EMBEDDING_CONFIG}
          updateConfig={updateConfig}
        />
      </TwoColumnGrid>
      <EmbeddingIndexControls />
      <FeedbackSettings />
      <ConfirmActionDialog
        open={confirmDialog.open}
        onOpenChange={(next) => {
          if (!next) closeConfirm()
        }}
        title={confirmConfig?.title || ""}
        confirmLabel={confirmConfig?.confirmLabel || t("common.save")}
        onConfirm={async () => {
          if (!confirmConfig) return
          closeConfirm()
          await confirmConfig.onConfirm()
        }}
      />
      <EmbeddingRebuildDialogs
        confirmRebuildOpen={confirmRebuildOpen}
        onConfirmRebuildOpenChange={setConfirmRebuildOpen}
        onConfirmRebuild={rebuild}
        modelChangeOpen={modelChangeOpen}
        onModelChangeOpenChange={setModelChangeOpen}
        onSwitchOnly={handleSwitchOnly}
        onSwitchAndRebuild={handleSwitchAndRebuild}
      />
    </SectionStack>
  )
}
