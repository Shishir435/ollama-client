import { useStorage } from "@plasmohq/storage/hook"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import {
  SettingsCard,
  SettingsFormField,
  SettingsSwitch,
  StatusAlert
} from "@/components/settings"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select"
import { useAutoEmbedMessages } from "@/features/chat/hooks/use-auto-embed-messages"
import { getEmbeddableMessagesBySession } from "@/features/chat/utils/embedding-backfill"
import { DataMigrationSettings } from "@/features/knowledge/components/data-migration-settings"
import { FeedbackSettings } from "@/features/knowledge/components/feedback-settings"
import { useProviderModels } from "@/features/model/hooks/use-provider-models"
import { browser } from "@/lib/browser-api"
import {
  DEFAULT_EMBEDDING_CONFIG,
  DEFAULT_EMBEDDING_MODEL,
  DEFAULT_PROVIDER_ID,
  type EmbeddingConfig,
  MESSAGE_KEYS,
  normalizeEmbeddingModelName,
  RECOMMENDED_EMBEDDING_MODELS,
  STORAGE_KEYS
} from "@/lib/constants"
import { clearEmbeddingCache } from "@/lib/embeddings/embedding-client"
import {
  clearAllVectors,
  getEmbeddingDimensionStats
} from "@/lib/embeddings/vector-store"
import { AlertTriangle, Database, RefreshCw } from "@/lib/lucide-icon"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"
import { getProviderDisplayName } from "@/lib/providers/registry"
import type { ChromeResponse } from "@/types"
import { EmbeddingGenerationConfig } from "./embedding-config/embedding-generation-config"
import { EmbeddingInfo } from "./embedding-info"
import { EmbeddingTestTools } from "./embedding-test-tools"

export const EmbeddingSettings = () => {
  const { t } = useTranslation()
  const [selectedModel, setSelectedModel] = useStorage<string>(
    {
      key: STORAGE_KEYS.EMBEDDINGS.SELECTED_MODEL,
      instance: plasmoGlobalStorage
    },
    DEFAULT_EMBEDDING_MODEL
  )
  const { models } = useProviderModels()
  const [config, setConfig] = useStorage<EmbeddingConfig>(
    {
      key: STORAGE_KEYS.EMBEDDINGS.CONFIG,
      instance: plasmoGlobalStorage
    },
    DEFAULT_EMBEDDING_CONFIG
  )

  const [modelExists, setModelExists] = useState<boolean>(false)
  const autoSwitchRef = useRef(false)
  const lastCheckedModelRef = useRef<string | null>(null)
  const [dimensionStats, setDimensionStats] = useState<{
    totalVectors: number
    byDimension: Record<string, number>
    mixedDimensions: boolean
    dominantDimension: number | null
  } | null>(null)
  const [isRebuilding, setIsRebuilding] = useState(false)
  const [rebuildProgress, setRebuildProgress] = useState<{
    current: number
    total: number
  } | null>(null)
  const [rebuildError, setRebuildError] = useState<string | null>(null)
  const [rebuildComplete, setRebuildComplete] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [modelChangeOpen, setModelChangeOpen] = useState(false)
  const [pendingModel, setPendingModel] = useState<{
    model: string
    providerId: string
  } | null>(null)
  const [memoryEnabled] = useStorage<boolean>(
    {
      key: STORAGE_KEYS.MEMORY.ENABLED,
      instance: plasmoGlobalStorage
    },
    true
  )
  const { embedMessages } = useAutoEmbedMessages()

  useEffect(() => {
    if (
      config?.sharedEmbeddingModel &&
      config.sharedEmbeddingModel !== selectedModel
    ) {
      setSelectedModel(config.sharedEmbeddingModel)
    }
  }, [config?.sharedEmbeddingModel, selectedModel, setSelectedModel])

  const recommendedModelSet = useMemo(
    () => new Set(RECOMMENDED_EMBEDDING_MODELS.map((m) => m.toLowerCase())),
    []
  )
  const recommendedBaseSet = useMemo(
    () =>
      new Set(
        RECOMMENDED_EMBEDDING_MODELS.map((m) => m.toLowerCase().split(":")[0])
      ),
    []
  )

  const isLikelyEmbeddingModelName = useCallback(
    (name: string) => {
      const normalized = name.toLowerCase()
      const base = normalized.split(":")[0] || normalized

      if (recommendedModelSet.has(normalized) || recommendedBaseSet.has(base)) {
        return true
      }

      if (normalized.includes("embed") || normalized.includes("embedding")) {
        return true
      }

      if (normalized.includes("bge") || normalized.includes("e5")) {
        return true
      }

      if (normalized.includes("gte") || normalized.includes("jina")) {
        return true
      }

      if (
        normalized.includes("minilm") ||
        normalized.includes("sentence-transformers")
      ) {
        return true
      }

      return false
    },
    [recommendedBaseSet, recommendedModelSet]
  )

  const embeddingModels = useMemo(
    () => models.filter((model) => isLikelyEmbeddingModelName(model.name)),
    [isLikelyEmbeddingModelName, models]
  )
  const showAdvancedModels = config?.showAdvancedEmbeddingModels ?? false
  const hasAdvancedModels = useMemo(
    () =>
      embeddingModels.some(
        (model) =>
          !recommendedBaseSet.has(model.name.toLowerCase().split(":")[0])
      ),
    [embeddingModels, recommendedBaseSet]
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

  const loadDimensionStats = useCallback(async () => {
    try {
      const stats = await getEmbeddingDimensionStats()
      setDimensionStats(stats)
    } catch (error) {
      console.error("Failed to load embedding dimension stats:", error)
    }
  }, [])

  useEffect(() => {
    loadDimensionStats()
  }, [loadDimensionStats])

  // We need to check model existence here to pass to children
  useEffect(() => {
    const normalized = normalizeEmbeddingModelName(selectedModel)
    if (normalized !== selectedModel) {
      setSelectedModel(normalized)
      return
    }

    if (selectedModel !== lastCheckedModelRef.current) {
      autoSwitchRef.current = false
      lastCheckedModelRef.current = selectedModel
    }

    const checkModel = async () => {
      try {
        const currentModel = selectedModel || DEFAULT_EMBEDDING_MODEL
        const isEmbeddingModel = isLikelyEmbeddingModelName(currentModel)
        const currentProviderId = resolveProviderForModel(currentModel)
        const response = (await browser.runtime.sendMessage({
          type: MESSAGE_KEYS.PROVIDER.CHECK_EMBEDDING_MODEL,
          payload: { model: currentModel, providerId: currentProviderId }
        })) as ChromeResponse & { data?: { exists?: boolean; debug?: object } }

        if (response?.data?.debug) {
          console.log(
            `[EmbeddingSettings] Check debug for ${currentModel}:`,
            response.data.debug
          )
        }

        if (
          isEmbeddingModel &&
          response?.success === true &&
          response.data?.exists === true
        ) {
          setModelExists(true)
        } else {
          setModelExists(false)
          if (!autoSwitchRef.current) {
            const providerModels = embeddingModels.filter(
              (m) => m.providerId === DEFAULT_PROVIDER_ID
            )
            const candidates =
              providerModels.length > 0 ? providerModels : embeddingModels

            const matchByRecommended = candidates.find((m) =>
              recommendedBaseSet.has(m.name.toLowerCase().split(":")[0])
            )
            const matchByEmbedName = candidates.find((m) => {
              const modelName = m.name.toLowerCase()
              return (
                modelName.includes("embed") || modelName.includes("embedding")
              )
            })

            const nextModel = matchByRecommended?.name || matchByEmbedName?.name

            if (nextModel && nextModel !== currentModel) {
              autoSwitchRef.current = true
              setSelectedModel(nextModel)
              updateConfig({
                sharedEmbeddingModel: nextModel,
                sharedEmbeddingProviderId: resolveProviderForModel(nextModel)
              })
            }
          }
        }
      } catch (error) {
        console.error("Error checking embedding model in parent:", error)
        setModelExists(false)
      }
    }

    checkModel()
    // Poll occasionally or when model changes
    const interval = setInterval(checkModel, 5000)
    return () => clearInterval(interval)
  }, [
    embeddingModels,
    isLikelyEmbeddingModelName,
    recommendedBaseSet,
    resolveProviderForModel,
    selectedModel,
    setSelectedModel,
    updateConfig
  ])

  const handleRebuildEmbeddings = useCallback(async () => {
    setIsRebuilding(true)
    setRebuildError(null)
    setRebuildComplete(false)
    setRebuildProgress(null)

    try {
      clearEmbeddingCache()
      await clearAllVectors()
      await loadDimensionStats()

      if (memoryEnabled) {
        const { messagesBySession, totalMessages } =
          await getEmbeddableMessagesBySession()

        setRebuildProgress({ current: 0, total: totalMessages })

        let processedMessages = 0
        for (const [sessionId, messages] of messagesBySession.entries()) {
          if (messages.length === 0) continue
          await embedMessages(messages, sessionId)
          processedMessages += messages.length
          setRebuildProgress({
            current: processedMessages,
            total: totalMessages
          })

          await new Promise((resolve) => setTimeout(resolve, 100))
        }
      }

      setRebuildComplete(true)
      await loadDimensionStats()
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to rebuild embeddings"
      console.error("Failed to rebuild embeddings:", error)
      setRebuildError(message)
    } finally {
      setIsRebuilding(false)
    }
  }, [embedMessages, loadDimensionStats, memoryEnabled])

  const showMixedDimensions =
    !!dimensionStats?.mixedDimensions && (dimensionStats?.totalVectors ?? 0) > 0
  const dimensionSummary = dimensionStats
    ? Object.entries(dimensionStats.byDimension)
        .sort((a, b) => Number(b[0]) - Number(a[0]))
        .map(([dimension, count]) => `${dimension}d (${count})`)
        .join(", ")
    : ""
  const rebuildPercentage =
    rebuildProgress && rebuildProgress.total > 0
      ? (rebuildProgress.current / rebuildProgress.total) * 100
      : 0

  const handleSwitchWithoutRebuild = useCallback(() => {
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
    await handleRebuildEmbeddings()
  }, [applyModelChange, handleRebuildEmbeddings, pendingModel])

  return (
    <div className="space-y-6">
      {showMixedDimensions && (
        <div className="space-y-3">
          <StatusAlert
            variant="warning"
            icon={AlertTriangle}
            title={t("settings.context.embedding_health.title")}
            description={
              <div className="space-y-1">
                <p>
                  {t("settings.context.embedding_health.description", {
                    dimensions: dimensionSummary
                  })}
                </p>
                <p>{t("settings.context.embedding_health.note")}</p>
                {!memoryEnabled && (
                  <p>
                    {t("settings.context.embedding_health.memory_disabled")}
                  </p>
                )}
              </div>
            }
            actions={
              <Button
                variant="outline"
                size="sm"
                onClick={() => setConfirmOpen(true)}
                disabled={isRebuilding}>
                {isRebuilding ? (
                  <>
                    <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                    {t("settings.context.embedding_health.action_rebuilding")}
                  </>
                ) : (
                  <>
                    <RefreshCw className="h-4 w-4 mr-2" />
                    {t("settings.context.embedding_health.action")}
                  </>
                )}
              </Button>
            }
          />

          {isRebuilding && rebuildProgress && rebuildProgress.total > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  {t("settings.context.embedding_health.progress", {
                    current: rebuildProgress.current,
                    total: rebuildProgress.total
                  })}
                </span>
                <span>{Math.round(rebuildPercentage)}%</span>
              </div>
              <Progress value={rebuildPercentage} />
            </div>
          )}
        </div>
      )}

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
      {(() => {
        const labelMap = new Map<string, string>()
        RECOMMENDED_EMBEDDING_MODELS.forEach((modelName) => {
          const label =
            modelName === DEFAULT_EMBEDDING_MODEL
              ? `${modelName} (${t(
                  "settings.content_extraction.badges.recommended"
                )})`
              : modelName
          labelMap.set(modelName, label)
        })
        embeddingModels.forEach((model) => {
          const label = `${model.name} (${
            model.providerName || getProviderDisplayName(DEFAULT_PROVIDER_ID)
          })`
          labelMap.set(model.name, label)
        })
        return (
          <>
            <SettingsCard
              icon={Database}
              title={t("settings.embeddings.title")}
              description={t("settings.embeddings.description")}
              badge="Beta">
              <div className="space-y-4">
                <EmbeddingInfo />

                {isRebuilding && (
                  <div className="space-y-3">
                    <StatusAlert
                      variant="info"
                      icon={RefreshCw}
                      title={t(
                        "settings.context.embedding_health.action_rebuilding"
                      )}
                      description={
                        rebuildProgress && rebuildProgress.total > 0
                          ? t("settings.context.embedding_health.progress", {
                              current: rebuildProgress.current,
                              total: rebuildProgress.total
                            })
                          : t(
                              "settings.context.embedding_health.status_starting"
                            )
                      }
                    />
                    {rebuildProgress && rebuildProgress.total > 0 && (
                      <Progress value={rebuildPercentage} />
                    )}
                  </div>
                )}

                <div className="rounded-lg border p-4 space-y-4">
                  <SettingsFormField
                    label={t("settings.embeddings.model_select.label")}
                    description={t(
                      "settings.embeddings.model_select.description"
                    )}>
                    <Select
                      value={selectedModel}
                      onValueChange={(value) => {
                        const normalized = normalizeEmbeddingModelName(value)
                        const providerId = resolveProviderForModel(normalized)
                        if (normalized === selectedModel) return
                        setPendingModel({ model: normalized, providerId })
                        setModelChangeOpen(true)
                      }}>
                      <SelectTrigger>
                        <SelectValue
                          placeholder={t(
                            "settings.embeddings.model_select.placeholder"
                          )}>
                          {(value) =>
                            value
                              ? labelMap.get(String(value)) || String(value)
                              : null
                          }
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          <SelectLabel>
                            {t(
                              "settings.embeddings.model_select.recommended_group"
                            )}
                          </SelectLabel>
                          {RECOMMENDED_EMBEDDING_MODELS.map((modelName) => (
                            <SelectItem key={modelName} value={modelName}>
                              {modelName}
                              {modelName === DEFAULT_EMBEDDING_MODEL
                                ? ` (${t("settings.content_extraction.badges.recommended")})`
                                : ""}
                            </SelectItem>
                          ))}
                        </SelectGroup>

                        {showAdvancedModels && hasAdvancedModels && (
                          <SelectGroup>
                            <SelectLabel>
                              {t(
                                "settings.embeddings.model_select.all_models_group"
                              )}
                            </SelectLabel>
                            {embeddingModels
                              .filter(
                                (m) =>
                                  !recommendedBaseSet.has(
                                    m.name.toLowerCase().split(":")[0]
                                  )
                              )
                              .map((model) => (
                                <SelectItem
                                  key={`${model.providerId}-${model.name}`}
                                  value={model.name}>
                                  {model.name} (
                                  {model.providerName ||
                                    getProviderDisplayName(DEFAULT_PROVIDER_ID)}
                                  )
                                </SelectItem>
                              ))}
                          </SelectGroup>
                        )}
                      </SelectContent>
                    </Select>
                  </SettingsFormField>

                  {hasAdvancedModels && (
                    <SettingsSwitch
                      label={t(
                        "settings.embeddings.model_select.show_advanced_label"
                      )}
                      description={t(
                        "settings.embeddings.model_select.show_advanced_description"
                      )}
                      checked={showAdvancedModels}
                      onCheckedChange={(checked) =>
                        updateConfig({ showAdvancedEmbeddingModels: checked })
                      }
                    />
                  )}
                </div>
              </div>
            </SettingsCard>

            {modelExists && <EmbeddingTestTools modelExists={modelExists} />}

            <EmbeddingGenerationConfig
              config={config || DEFAULT_EMBEDDING_CONFIG}
              updateConfig={updateConfig}
            />

            <FeedbackSettings />

            <DataMigrationSettings />
          </>
        )
      })()}

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("settings.context.embedding_health.confirm")}
            </AlertDialogTitle>
            <AlertDialogDescription />
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                setConfirmOpen(false)
                await handleRebuildEmbeddings()
              }}>
              {t("settings.context.embedding_health.action")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={modelChangeOpen} onOpenChange={setModelChangeOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("settings.embeddings.model_change_confirm.title")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("settings.embeddings.model_change_confirm.description")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="grid gap-2 sm:grid-cols-2 sm:gap-3">
            <AlertDialogCancel className="text-center whitespace-normal sm:whitespace-nowrap">
              {t("common.cancel")}
            </AlertDialogCancel>
            <Button
              variant="secondary"
              onClick={handleSwitchWithoutRebuild}
              className="text-center whitespace-normal sm:whitespace-nowrap">
              {t("settings.embeddings.model_change_confirm.switch_only")}
            </Button>
            <AlertDialogAction
              onClick={handleSwitchAndRebuild}
              className="text-center whitespace-normal sm:whitespace-nowrap sm:col-span-2 sm:justify-self-center">
              {t("settings.embeddings.model_change_confirm.switch_and_rebuild")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
