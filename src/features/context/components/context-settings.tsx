import { useStorage } from "@plasmohq/storage/hook"
import { useCallback, useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { SettingsCard, StatusAlert } from "@/components/settings"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { Separator } from "@/components/ui/separator"
import { ChatBackfillPanel } from "@/features/chat/components/chat-backfill-panel"
import { useAutoEmbedMessages } from "@/features/chat/hooks/use-auto-embed-messages"
import { getEmbeddableMessagesBySession } from "@/features/chat/utils/embedding-backfill"
import { FileUploadSettings } from "@/features/file-upload/components/file-upload-settings"
import {
  RAGSettings,
  TextSplittingSettings
} from "@/features/knowledge/components"
import { FeedbackSettings } from "@/features/knowledge/components/feedback-settings"
import { MemorySettings } from "@/features/memory/components/memory-settings"
import { DatabaseManagementCard } from "@/features/model/components/embedding-config/database-management-card"
import { EmbeddingLimitsConfig } from "@/features/model/components/embedding-config/embedding-limits-config"
import { StorageStatsCard } from "@/features/model/components/embedding-config/storage-stats-card"
import { EmbeddingIndexControls } from "@/features/model/components/embedding-index-controls"
import {
  DEFAULT_EMBEDDING_CONFIG,
  type EmbeddingConfig,
  STORAGE_KEYS
} from "@/lib/constants"
import {
  clearEmbeddingCache,
  getCacheStats
} from "@/lib/embeddings/embedding-client"
import {
  clearAllVectors,
  getEmbeddingDimensionStats,
  getStorageStats,
  removeDuplicateVectors
} from "@/lib/embeddings/vector-store"
import {
  AlertTriangle,
  BookOpen,
  RefreshCw,
  Scissors,
  Upload
} from "@/lib/lucide-icon"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"

const useEmbeddingConfig = () => {
  const [config, setConfig] = useStorage<EmbeddingConfig>(
    {
      key: STORAGE_KEYS.EMBEDDINGS.CONFIG,
      instance: plasmoGlobalStorage
    },
    DEFAULT_EMBEDDING_CONFIG
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

  return { config, updateConfig }
}

export const ContextSettings = () => {
  const { t } = useTranslation()
  const { config, updateConfig } = useEmbeddingConfig()
  const [memoryEnabled] = useStorage<boolean>(
    {
      key: STORAGE_KEYS.MEMORY.ENABLED,
      instance: plasmoGlobalStorage
    },
    true
  )
  const { embedMessages } = useAutoEmbedMessages()

  const [storageStats, setStorageStats] = useState<{
    totalVectors: number
    totalSizeMB: number
    byType: Record<string, number>
  } | null>(null)
  const [dimensionStats, setDimensionStats] = useState<{
    totalVectors: number
    byDimension: Record<string, number>
    mixedDimensions: boolean
    dominantDimension: number | null
  } | null>(null)
  const [cacheStats, setCacheStats] = useState<{
    size: number
    maxSize: number
  } | null>(null)
  const [isCleaning, setIsCleaning] = useState(false)
  const [isRebuilding, setIsRebuilding] = useState(false)
  const [rebuildProgress, setRebuildProgress] = useState<{
    current: number
    total: number
  } | null>(null)
  const [rebuildError, setRebuildError] = useState<string | null>(null)
  const [rebuildComplete, setRebuildComplete] = useState(false)
  const isLoadingRef = useRef(false)

  const loadStats = useCallback(async () => {
    if (isLoadingRef.current) return

    isLoadingRef.current = true
    try {
      const statsPromise = getStorageStats()
      const dimensionPromise = getEmbeddingDimensionStats()
      const cacheStatsValue = getCacheStats()

      const [statsResult, dimensionResult] = await Promise.allSettled([
        statsPromise,
        dimensionPromise
      ])

      if (statsResult.status === "fulfilled") {
        setStorageStats(statsResult.value)
      }
      if (dimensionResult.status === "fulfilled") {
        setDimensionStats(dimensionResult.value)
      }
      setCacheStats(cacheStatsValue)
    } catch (error) {
      console.error("Failed to load stats:", error)
    } finally {
      isLoadingRef.current = false
    }
  }, [])

  useEffect(() => {
    loadStats()

    const interval = setInterval(() => {
      if (document.visibilityState === "visible") {
        loadStats()
      }
    }, 10000)

    return () => clearInterval(interval)
  }, [loadStats])

  const handleRemoveDuplicates = useCallback(async () => {
    if (
      !confirm(
        "Remove duplicate embeddings? This will keep only the first occurrence of each unique message."
      )
    ) {
      return
    }

    setIsCleaning(true)
    try {
      const { deleted, kept } = await removeDuplicateVectors()
      alert(
        `Removed ${deleted} duplicate(s). Kept ${kept} unique embedding(s).`
      )
      await loadStats()
    } catch (error) {
      console.error("Failed to remove duplicates:", error)
      alert("Failed to remove duplicates. Check console for details.")
    } finally {
      setIsCleaning(false)
    }
  }, [loadStats])

  const handleClearChatVectors = useCallback(async () => {
    if (
      !confirm(
        "Clear all chat embeddings? This will delete all semantic search data for chats. You can backfill later."
      )
    ) {
      return
    }

    setIsCleaning(true)
    try {
      const deleted = await clearAllVectors("chat")
      alert(`Cleared ${deleted} chat embedding(s).`)
      await loadStats()
    } catch (error) {
      console.error("Failed to clear chat vectors:", error)
      alert("Failed to clear chat vectors. Check console for details.")
    } finally {
      setIsCleaning(false)
    }
  }, [loadStats])

  const handleClearAllVectors = useCallback(async () => {
    if (
      !confirm(
        "Clear ALL embeddings? This will delete all semantic search data (chats, files, webpages). This action cannot be undone."
      )
    ) {
      return
    }

    setIsCleaning(true)
    try {
      await clearAllVectors()
      alert("All embeddings cleared.")
      await loadStats()
    } catch (error) {
      console.error("Failed to clear all vectors:", error)
      alert("Failed to clear all vectors. Check console for details.")
    } finally {
      setIsCleaning(false)
    }
  }, [loadStats])

  const handleRebuildEmbeddings = useCallback(async () => {
    if (!confirm(t("settings.context.embedding_health.confirm"))) {
      return
    }

    setIsRebuilding(true)
    setRebuildError(null)
    setRebuildComplete(false)
    setRebuildProgress(null)

    try {
      clearEmbeddingCache()
      await clearAllVectors()
      await loadStats()

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
      await loadStats()
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to rebuild embeddings"
      console.error("Failed to rebuild embeddings:", error)
      setRebuildError(message)
    } finally {
      setIsRebuilding(false)
    }
  }, [embedMessages, loadStats, memoryEnabled, t])

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
                onClick={handleRebuildEmbeddings}
                disabled={isRebuilding || isCleaning}>
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

      <MemorySettings />
      <ChatBackfillPanel />

      <SettingsCard
        icon={BookOpen}
        title={t("model.embedding_config.rag_settings_title")}
        description={t("model.embedding_config.rag_settings_description")}>
        <RAGSettings />
      </SettingsCard>

      <FeedbackSettings />

      <SettingsCard
        icon={Upload}
        title={t("settings.context.file_upload.title")}
        description={t("settings.context.file_upload.description")}>
        <FileUploadSettings />
      </SettingsCard>

      <SettingsCard
        icon={Scissors}
        title={t("model.embedding_config.chunking_title")}
        description={t("model.embedding_config.chunking_description")}>
        <TextSplittingSettings />
      </SettingsCard>

      <Separator />

      {storageStats && (
        <StorageStatsCard storageStats={storageStats} cacheStats={cacheStats} />
      )}

      <DatabaseManagementCard
        onRemoveDuplicates={handleRemoveDuplicates}
        onClearChat={handleClearChatVectors}
        onClearAll={handleClearAllVectors}
        isCleaning={isCleaning || isRebuilding}
        hasVectors={!!storageStats?.totalVectors}
        hasChatVectors={!!storageStats?.byType?.chat}
      />

      <EmbeddingLimitsConfig config={config} updateConfig={updateConfig} />

      <EmbeddingIndexControls />
    </div>
  )
}
