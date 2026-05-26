import { useStorage } from "@plasmohq/storage/hook"
import { useCallback, useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { SectionStack } from "@/components/layout"
import { StatusAlert } from "@/components/settings"
import { DataMigrationSettings } from "@/features/knowledge/components/data-migration-settings"
import { FeedbackSettings } from "@/features/knowledge/components/feedback-settings"
import { useEmbeddingDimensionStats } from "@/features/model/hooks/use-embedding-dimension-stats"
import { useEmbeddingModelCheck } from "@/features/model/hooks/use-embedding-model-check"
import { useEmbeddingRebuild } from "@/features/model/hooks/use-embedding-rebuild"
import { useProviderModels } from "@/features/model/hooks/use-provider-models"
import {
  DEFAULT_EMBEDDING_CONFIG,
  DEFAULT_EMBEDDING_MODEL,
  DEFAULT_PROVIDER_ID,
  type EmbeddingConfig,
  STORAGE_KEYS
} from "@/lib/constants"
import {
  isLikelyEmbeddingModelName,
  recommendedEmbeddingBaseSet
} from "@/lib/embeddings/model-name-filter"
import { AlertTriangle, RefreshCw } from "@/lib/lucide-icon"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"

import { EmbeddingGenerationConfig } from "./embedding-config/embedding-generation-config"
import { EmbeddingHealthAlert } from "./embedding-config/embedding-health-alert"
import { EmbeddingModelSelector } from "./embedding-config/embedding-model-selector"
import { EmbeddingRebuildDialogs } from "./embedding-config/embedding-rebuild-dialogs"
import { EmbeddingTestGeneration } from "./embedding-config/embedding-test-generation"
import { EmbeddingTestSearch } from "./embedding-config/embedding-test-search"

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
      <FeedbackSettings />
      <DataMigrationSettings />
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
