import { useStorage } from "@plasmohq/storage/hook"
import { memo, useCallback, useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { ChatBackfillPanel } from "@/features/chat/components/chat-backfill-panel"
import { FormSectionCard } from "@/features/model/components/form-section-card"
import {
  type ChunkingStrategy,
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
import {
  Database,
  MessageSquare,
  Scissors,
  Settings,
  Sparkles,
  Trash2,
  Zap
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

const AutoEmbedChatToggle = memo(() => {
  const [autoEmbedEnabled, setAutoEmbedEnabled] = useStorage<boolean>(
    {
      key: STORAGE_KEYS.EMBEDDINGS.AUTO_EMBED_CHAT,
      instance: plasmoGlobalStorage
    },
    true
  )

  return (
    <Switch
      id="autoEmbedChat"
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
      const result = await removeDuplicateVectors()
      alert(
        `Removed ${result.removed} duplicate(s). Kept ${result.kept} unique embedding(s).`
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
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Database className="h-5 w-5" />
              {t("model.embedding_config.storage_stats_title")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-muted-foreground">
                  {t("model.embedding_config.total_vectors")}
                </p>
                <p className="text-2xl font-bold">
                  {storageStats.totalVectors}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">
                  {t("model.embedding_config.storage_used")}
                </p>
                <p className="text-2xl font-bold">
                  {storageStats.totalSizeMB.toFixed(2)} MB
                </p>
              </div>
            </div>
            {cacheStats && (
              <div className="mt-4 pt-4 border-t">
                <p className="text-sm text-muted-foreground">
                  {t("model.embedding_config.cache")}
                </p>
                <p className="text-sm">
                  {t("model.embedding_config.cache_entries", {
                    size: cacheStats.size,
                    maxSize: cacheStats.maxSize
                  })}
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Database Management */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Trash2 className="h-5 w-5" />
            {t("model.embedding_config.database_management_title")}
          </CardTitle>
          <CardDescription>
            {t("model.embedding_config.database_management_description")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-2">
            <Button
              variant="outline"
              onClick={handleRemoveDuplicates}
              disabled={isCleaning || !storageStats?.totalVectors}
              className="w-full">
              {t("model.embedding_config.remove_duplicates_button")}
            </Button>
            <p className="text-xs text-muted-foreground">
              {t("model.embedding_config.remove_duplicates_description")}
            </p>
          </div>

          <div className="space-y-2">
            <Button
              variant="outline"
              onClick={handleClearChatVectors}
              disabled={isCleaning || !storageStats?.byType?.chat}
              className="w-full">
              {t("model.embedding_config.clear_chat_button")}
            </Button>
            <p className="text-xs text-muted-foreground">
              {t("model.embedding_config.clear_chat_description")}
            </p>
          </div>

          <div className="space-y-2">
            <Button
              variant="destructive"
              onClick={handleClearAllVectors}
              disabled={isCleaning || !storageStats?.totalVectors}
              className="w-full">
              {t("model.embedding_config.clear_all_button")}
            </Button>
            <p className="text-xs text-muted-foreground">
              {t("model.embedding_config.clear_all_description")}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Chunking Settings */}
      <FormSectionCard
        icon={Scissors}
        title={t("model.embedding_config.chunking_title")}
        description={t("model.embedding_config.chunking_description")}>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="chunkSize">
              {t("model.embedding_config.chunk_size_label")}
            </Label>
            <div className="flex items-center gap-4">
              <Slider
                value={[config.chunkSize]}
                onValueChange={([value]) => updateConfig({ chunkSize: value })}
                min={100}
                max={2000}
                step={50}
                className="flex-1"
              />
              <Input
                id="chunkSize"
                type="number"
                value={config.chunkSize}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10)
                  if (!Number.isNaN(val) && val >= 100 && val <= 2000) {
                    updateConfig({ chunkSize: val })
                  }
                }}
                className="w-24"
                min={100}
                max={2000}
              />
            </div>
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>100</span>
              <span>2000</span>
            </div>
            <p className="text-xs text-muted-foreground">
              {t("model.embedding_config.chunk_size_description")}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="chunkOverlap">
              {t("model.embedding_config.chunk_overlap_label")}
            </Label>
            <div className="flex items-center gap-4">
              <Slider
                value={[config.chunkOverlap]}
                onValueChange={([value]) =>
                  updateConfig({ chunkOverlap: value })
                }
                min={0}
                max={500}
                step={25}
                className="flex-1"
              />
              <Input
                id="chunkOverlap"
                type="number"
                value={config.chunkOverlap}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10)
                  if (!Number.isNaN(val) && val >= 0 && val <= 500) {
                    updateConfig({ chunkOverlap: val })
                  }
                }}
                className="w-24"
                min={0}
                max={500}
              />
            </div>
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>0</span>
              <span>500</span>
            </div>
            <p className="text-xs text-muted-foreground">
              {t("model.embedding_config.chunk_overlap_description")}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="chunkingStrategy">
              {t("model.embedding_config.chunking_strategy_label")}
            </Label>
            <Select
              value={config.chunkingStrategy}
              onValueChange={(value: ChunkingStrategy) =>
                updateConfig({ chunkingStrategy: value })
              }>
              <SelectTrigger id="chunkingStrategy">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="fixed">
                  {t("model.embedding_config.strategy_fixed")}
                </SelectItem>
                <SelectItem value="semantic">
                  {t("model.embedding_config.strategy_semantic")}
                </SelectItem>
                <SelectItem value="hybrid">
                  {t("model.embedding_config.strategy_hybrid")}
                </SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {t("model.embedding_config.chunking_strategy_description")}
            </p>
          </div>
        </div>
      </FormSectionCard>

      {/* Embedding Generation Settings */}
      <FormSectionCard
        icon={Zap}
        title={t("model.embedding_config.embedding_gen_title")}
        description={t("model.embedding_config.embedding_gen_description")}>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="batchSize">
              {t("model.embedding_config.batch_size_label")}
            </Label>
            <Input
              id="batchSize"
              type="number"
              value={config.batchSize}
              onChange={(e) => {
                const val = parseInt(e.target.value, 10)
                if (!Number.isNaN(val) && val >= 1 && val <= 20) {
                  updateConfig({ batchSize: val })
                }
              }}
              min={1}
              max={20}
            />
            <p className="text-xs text-muted-foreground">
              {t("model.embedding_config.batch_size_description")}
            </p>
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="enableCaching">
                {t("model.embedding_config.enable_caching_label")}
              </Label>
              <p className="text-xs text-muted-foreground">
                {t("model.embedding_config.enable_caching_description")}
              </p>
            </div>
            <Switch
              id="enableCaching"
              checked={config.enableCaching}
              onCheckedChange={(checked) =>
                updateConfig({ enableCaching: checked })
              }
            />
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="useWebWorker">
                {t("model.embedding_config.use_webworker_label")}
              </Label>
              <p className="text-xs text-muted-foreground">
                {t("model.embedding_config.use_webworker_description")}
              </p>
            </div>
            <Switch
              id="useWebWorker"
              checked={config.useWebWorker}
              onCheckedChange={(checked) =>
                updateConfig({ useWebWorker: checked })
              }
            />
          </div>
        </div>
      </FormSectionCard>

      {/* Limits Settings */}
      <FormSectionCard
        icon={Settings}
        title={t("model.embedding_config.limits_title")}
        description={t("model.embedding_config.limits_description")}>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="maxEmbeddingsPerFile">
              {t("model.embedding_config.max_embeddings_label")}
            </Label>
            <Input
              id="maxEmbeddingsPerFile"
              type="number"
              value={config.maxEmbeddingsPerFile}
              onChange={(e) => {
                const val = parseInt(e.target.value, 10)
                if (!Number.isNaN(val) && val >= 0) {
                  updateConfig({
                    maxEmbeddingsPerFile: val
                  })
                }
              }}
              min={0}
            />
            <p className="text-xs text-muted-foreground">
              {t("model.embedding_config.max_embeddings_description")}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="maxStorageSize">
              {t("model.embedding_config.max_storage_label")}
            </Label>
            <Input
              id="maxStorageSize"
              type="number"
              value={config.maxStorageSize}
              onChange={(e) => {
                const val = parseInt(e.target.value, 10)
                if (!Number.isNaN(val) && val >= 0) {
                  updateConfig({
                    maxStorageSize: val
                  })
                }
              }}
              min={0}
            />
            <p className="text-xs text-muted-foreground">
              {t("model.embedding_config.max_storage_description")}
            </p>
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="autoCleanup">
                {t("model.embedding_config.auto_cleanup_label")}
              </Label>
              <p className="text-xs text-muted-foreground">
                {t("model.embedding_config.auto_cleanup_description")}
              </p>
            </div>
            <Switch
              id="autoCleanup"
              checked={config.autoCleanup}
              onCheckedChange={(checked) =>
                updateConfig({ autoCleanup: checked })
              }
            />
          </div>

          {config.autoCleanup && (
            <div className="space-y-2">
              <Label htmlFor="cleanupDaysOld">
                {t("model.embedding_config.cleanup_age_label")}
              </Label>
              <Input
                id="cleanupDaysOld"
                type="number"
                value={config.cleanupDaysOld}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10)
                  if (!Number.isNaN(val) && val >= 1) {
                    updateConfig({
                      cleanupDaysOld: val
                    })
                  }
                }}
                min={1}
              />
              <p className="text-xs text-muted-foreground">
                {t("model.embedding_config.cleanup_age_description")}
              </p>
            </div>
          )}
        </div>
      </FormSectionCard>

      {/* Chat Search Settings */}
      <FormSectionCard
        icon={MessageSquare}
        title={t("model.embedding_config.chat_search_title")}
        description={t("model.embedding_config.chat_search_description")}>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="autoEmbedChat">
                {t("model.embedding_config.auto_embed_label")}
              </Label>
              <p className="text-xs text-muted-foreground">
                {t("model.embedding_config.auto_embed_description")}
              </p>
            </div>
            <AutoEmbedChatToggle />
          </div>
        </div>
      </FormSectionCard>

      {/* Backfill Panel */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Sparkles className="h-5 w-5" />
            {t("model.embedding_config.backfill_title")}
          </CardTitle>
          <CardDescription>
            {t("model.embedding_config.backfill_description")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ChatBackfillPanel />
        </CardContent>
      </Card>

      {/* Search Settings */}
      <FormSectionCard
        icon={Settings}
        title={t("model.embedding_config.search_settings_title")}
        description={t("model.embedding_config.search_settings_description")}>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="defaultSearchLimit">
              {t("model.embedding_config.search_limit_label")}
            </Label>
            <Input
              id="defaultSearchLimit"
              type="number"
              value={config.defaultSearchLimit}
              onChange={(e) => {
                const val = parseInt(e.target.value, 10)
                if (!Number.isNaN(val) && val >= 1 && val <= 100) {
                  updateConfig({
                    defaultSearchLimit: val
                  })
                }
              }}
              min={1}
              max={100}
            />
            <p className="text-xs text-muted-foreground">
              {t("model.embedding_config.search_limit_description")}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="defaultMinSimilarity">
              {t("model.embedding_config.min_similarity_label")}
            </Label>
            <div className="flex items-center gap-4">
              <Slider
                value={[config.defaultMinSimilarity]}
                onValueChange={([value]) =>
                  updateConfig({ defaultMinSimilarity: value })
                }
                min={0}
                max={1}
                step={0.05}
                className="flex-1"
              />
              <Input
                id="defaultMinSimilarity"
                type="number"
                value={config.defaultMinSimilarity.toFixed(2)}
                onChange={(e) => {
                  const val = parseFloat(e.target.value)
                  if (!Number.isNaN(val) && val >= 0 && val <= 1) {
                    updateConfig({
                      defaultMinSimilarity: val
                    })
                  }
                }}
                className="w-24"
                min={0}
                max={1}
                step={0.05}
              />
            </div>
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>0</span>
              <span>1</span>
            </div>
            <p className="text-xs text-muted-foreground">
              {t("model.embedding_config.min_similarity_description")}
            </p>
          </div>

          <div className="space-y-2 pt-2 border-t">
            <Label htmlFor="searchCacheTTL">
              {t("model.embedding_config.cache_ttl_label")}
            </Label>
            <Input
              id="searchCacheTTL"
              type="number"
              value={config.searchCacheTTL}
              onChange={(e) => {
                const val = parseInt(e.target.value, 10)
                if (!Number.isNaN(val) && val >= 1 && val <= 60) {
                  updateConfig({
                    searchCacheTTL: val
                  })
                }
              }}
              min={1}
              max={60}
            />
            <p className="text-xs text-muted-foreground">
              {t("model.embedding_config.cache_ttl_description")}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="searchCacheMaxSize">
              {t("model.embedding_config.cache_max_size_label")}
            </Label>
            <Input
              id="searchCacheMaxSize"
              type="number"
              value={config.searchCacheMaxSize}
              onChange={(e) => {
                const val = parseInt(e.target.value, 10)
                if (!Number.isNaN(val) && val >= 10 && val <= 200) {
                  updateConfig({
                    searchCacheMaxSize: val
                  })
                }
              }}
              min={10}
              max={200}
            />
            <p className="text-xs text-muted-foreground">
              {t("model.embedding_config.cache_max_size_description")}
            </p>
          </div>
        </div>
      </FormSectionCard>
    </div>
  )
})

EmbeddingConfigSettings.displayName = "EmbeddingConfigSettings"
