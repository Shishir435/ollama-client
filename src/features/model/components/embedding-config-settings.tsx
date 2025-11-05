import { useStorage } from "@plasmohq/storage/hook"
import { memo, useCallback, useEffect, useRef, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
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
import { FormSectionCard } from "@/features/model/components/form-section-card"
import {
  type ChunkingStrategy,
  DEFAULT_EMBEDDING_CONFIG,
  type EmbeddingConfig,
  STORAGE_KEYS
} from "@/lib/constants"
import { getCacheStats } from "@/lib/embeddings/ollama-embedder"
import { getStorageStats } from "@/lib/embeddings/vector-store"
import { Database, Scissors, Settings, Zap } from "@/lib/lucide-icon"
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

export const EmbeddingConfigSettings = memo(() => {
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

  return (
    <div className="mx-auto space-y-6">
      {/* Statistics Card */}
      {storageStats && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Database className="h-5 w-5" />
              Storage Statistics
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-muted-foreground">Total Vectors</p>
                <p className="text-2xl font-bold">
                  {storageStats.totalVectors}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Storage Used</p>
                <p className="text-2xl font-bold">
                  {storageStats.totalSizeMB.toFixed(2)} MB
                </p>
              </div>
            </div>
            {cacheStats && (
              <div className="mt-4 pt-4 border-t">
                <p className="text-sm text-muted-foreground">Cache</p>
                <p className="text-sm">
                  {cacheStats.size} / {cacheStats.maxSize} entries
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Chunking Settings */}
      <FormSectionCard
        icon={Scissors}
        title="Chunking Settings"
        description="Configure how text is split into chunks for embedding">
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="chunkSize">Chunk Size (tokens)</Label>
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
              Number of tokens per chunk. Larger chunks preserve more context
              but may be less focused.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="chunkOverlap">Chunk Overlap (tokens)</Label>
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
              Overlap between chunks to preserve context across boundaries.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="chunkingStrategy">Chunking Strategy</Label>
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
                  Fixed Size - Split at fixed token boundaries
                </SelectItem>
                <SelectItem value="semantic">
                  Semantic - Split at sentence/paragraph boundaries
                </SelectItem>
                <SelectItem value="hybrid">
                  Hybrid - Try semantic first, fallback to fixed
                </SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Strategy for splitting text. Hybrid is recommended for best
              results.
            </p>
          </div>
        </div>
      </FormSectionCard>

      {/* Performance Settings */}
      <FormSectionCard
        icon={Zap}
        title="Performance Settings"
        description="Optimize embedding generation for your system">
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="batchSize">Batch Size</Label>
            <div className="flex items-center gap-4">
              <Slider
                value={[config.batchSize]}
                onValueChange={([value]) => updateConfig({ batchSize: value })}
                min={1}
                max={20}
                step={1}
                className="flex-1"
              />
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
                className="w-24"
                min={1}
                max={20}
              />
            </div>
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>1</span>
              <span>20</span>
            </div>
            <p className="text-xs text-muted-foreground">
              Number of embeddings to generate in parallel. Lower values use
              less memory but are slower.
            </p>
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="enableCaching">Enable Caching</Label>
              <p className="text-xs text-muted-foreground">
                Cache embeddings for identical content to avoid regenerating
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
              <Label htmlFor="useWebWorker">Use Web Worker</Label>
              <p className="text-xs text-muted-foreground">
                Offload embedding generation to background thread (recommended)
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
        title="Limits & Storage"
        description="Configure storage limits and cleanup policies">
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="maxEmbeddingsPerFile">
              Max Embeddings Per File
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
              Maximum embeddings per file (0 = unlimited). Helps prevent memory
              issues with very large files.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="maxStorageSize">Max Storage Size (MB)</Label>
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
              Maximum storage size in MB (0 = unlimited). Oldest vectors will be
              deleted when limit is reached.
            </p>
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="autoCleanup">Auto Cleanup</Label>
              <p className="text-xs text-muted-foreground">
                Automatically delete old embeddings
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
              <Label htmlFor="cleanupDaysOld">Cleanup Age (days)</Label>
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
                Delete embeddings older than this many days
              </p>
            </div>
          )}
        </div>
      </FormSectionCard>

      {/* Search Settings */}
      <FormSectionCard
        icon={Settings}
        title="Search Settings"
        description="Default parameters for semantic search">
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="defaultSearchLimit">Default Search Limit</Label>
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
              Default number of results to return from semantic search
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="defaultMinSimilarity">
              Minimum Similarity Threshold
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
              Minimum cosine similarity score (0-1). Higher values return more
              relevant but fewer results.
            </p>
          </div>
        </div>
      </FormSectionCard>
    </div>
  )
})

EmbeddingConfigSettings.displayName = "EmbeddingConfigSettings"
