import { useStorage } from "@plasmohq/storage/hook"
import { memo, useCallback, useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { SettingsCard, SettingsSwitch } from "@/components/settings"
import { ChatBackfillPanel } from "@/features/chat/components/chat-backfill-panel"
import {
  RAGSettings,
  TextSplittingSettings
} from "@/features/knowledge/components"
import {
  DEFAULT_EMBEDDING_CONFIG,
  type EmbeddingConfig,
  STORAGE_KEYS
} from "@/lib/constants"
import { getCacheStats } from "@/lib/embeddings/ollama-embedder"
import {
  clearAllVectors,
  getStorageStats,
  removeDuplicateVectors
} from "@/lib/embeddings/vector-store"
import { BookOpen, MessageSquare, Scissors } from "@/lib/lucide-icon"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"

import { DatabaseManagementCard } from "./embedding-config/database-management-card"
import { EmbeddingGenerationConfig } from "./embedding-config/embedding-generation-config"
import { EmbeddingLimitsConfig } from "./embedding-config/embedding-limits-config"
import { EmbeddingSearchConfig } from "./embedding-config/embedding-search-config"
import { StorageStatsCard } from "./embedding-config/storage-stats-card"

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

const AutoEmbedChatToggle = memo(() => {
  const { t } = useTranslation()
  const [autoEmbedEnabled, setAutoEmbedEnabled] = useStorage<boolean>(
    {
      key: STORAGE_KEYS.EMBEDDINGS.AUTO_EMBED_CHAT,
      instance: plasmoGlobalStorage
    },
    true
  )

  return (
    <SettingsSwitch
      label={t("model.embedding_config.auto_embed_label")}
      description={t("model.embedding_config.auto_embed_description")}
      checked={autoEmbedEnabled ?? true}
      onCheckedChange={setAutoEmbedEnabled}
    />
  )
})

AutoEmbedChatToggle.displayName = "AutoEmbedChatToggle"

export const EmbeddingConfigSettings = memo(() => {
  const { t } = useTranslation()
  const { config, updateConfig } = useEmbeddingConfig()
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
  const isLoadingRef = useRef(false)

  // Memoize the load stats function to prevent unnecessary recreations
  const loadStats = useCallback(async () => {
    // Prevent concurrent loads using ref to avoid dependency issues
    if (isLoadingRef.current) return

    isLoadingRef.current = true
    try {
      // Use requestIdleCallback if available to avoid blocking main thread
      const statsPromise = getStorageStats()
      const cacheStatsValue = getCacheStats()

      // Use Promise.allSettled to handle errors gracefully
      const [statsResult] = await Promise.allSettled([statsPromise])

      if (statsResult.status === "fulfilled") {
        setStorageStats(statsResult.value)
      }
      setCacheStats(cacheStatsValue)
    } catch (error) {
      console.error("Failed to load stats:", error)
    } finally {
      isLoadingRef.current = false
    }
  }, [])

  useEffect(() => {
    // Initial load
    loadStats()

    // Use longer interval and check if tab is visible to reduce unnecessary work
    const interval = setInterval(() => {
      // Only refresh if document is visible (tab is active)
      if (document.visibilityState === "visible") {
        loadStats()
      }
    }, 10000) // Increased from 5s to 10s to reduce load

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

  return (
    <div className="mx-auto space-y-6">
      {/* Statistics Card */}
      {storageStats && (
        <StorageStatsCard storageStats={storageStats} cacheStats={cacheStats} />
      )}

      {/* Database Management */}
      <DatabaseManagementCard
        onRemoveDuplicates={handleRemoveDuplicates}
        onClearChat={handleClearChatVectors}
        onClearAll={handleClearAllVectors}
        isCleaning={isCleaning}
        hasVectors={!!storageStats?.totalVectors}
        hasChatVectors={!!storageStats?.byType?.chat}
      />

      {/* Chunking Settings */}
      <SettingsCard
        icon={Scissors}
        title={t("model.embedding_config.chunking_title")}
        description={t("model.embedding_config.chunking_description")}>
        <TextSplittingSettings />
      </SettingsCard>

      {/* Embedding Generation Settings */}
      <EmbeddingGenerationConfig config={config} updateConfig={updateConfig} />

      {/* RAG Settings */}
      <SettingsCard
        icon={BookOpen}
        title={t("model.embedding_config.rag_settings_title")}
        description={t("model.embedding_config.rag_settings_description")}>
        <RAGSettings />
      </SettingsCard>

      {/* Limits Settings */}
      <EmbeddingLimitsConfig config={config} updateConfig={updateConfig} />

      {/* Chat Search Settings */}
      <SettingsCard
        icon={MessageSquare}
        title={t("model.embedding_config.chat_search_title")}
        description={t("model.embedding_config.chat_search_description")}>
        <AutoEmbedChatToggle />
      </SettingsCard>

      <ChatBackfillPanel />

      <EmbeddingSearchConfig config={config} updateConfig={updateConfig} />
    </div>
  )
})

EmbeddingConfigSettings.displayName = "EmbeddingConfigSettings"
