import { useStorage } from "@plasmohq/storage/hook"
import { useEffect, useState } from "react"
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
import { knowledgeConfig } from "@/lib/config/knowledge-config"
import {
  type ChunkingStrategy,
  DEFAULT_EMBEDDING_CONFIG,
  type EmbeddingConfig,
  STORAGE_KEYS
} from "@/lib/constants"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"

export const TextSplittingSettings = () => {
  const [config, setConfig] = useStorage<EmbeddingConfig>(
    {
      key: STORAGE_KEYS.EMBEDDINGS.CONFIG,
      instance: plasmoGlobalStorage
    },
    DEFAULT_EMBEDDING_CONFIG
  )

  const [chunkSize, setChunkSize] = useState(config.chunkSize)
  const [chunkOverlap, setChunkOverlap] = useState(config.chunkOverlap)

  // Sync local state with storage
  useEffect(() => {
    setChunkSize(config.chunkSize)
    setChunkOverlap(config.chunkOverlap)
  }, [config.chunkSize, config.chunkOverlap])

  // Update knowledge config when storage changes
  useEffect(() => {
    const updateKnowledgeConfig = async () => {
      await knowledgeConfig.setChunkSize(config.chunkSize)
      await knowledgeConfig.setChunkOverlap(config.chunkOverlap)
      await knowledgeConfig.setSplittingStrategy(
        config.useEnhancedChunking ? "recursive" : "character"
      )
    }
    updateKnowledgeConfig()
  }, [config])

  const handleChunkSizeChange = (value: number[]) => {
    const size = value[0]
    setChunkSize(size)
    setConfig((prev) => ({ ...prev, chunkSize: size }))
  }

  const handleChunkOverlapChange = (value: number[]) => {
    const overlap = value[0]
    setChunkOverlap(overlap)
    setConfig((prev) => ({ ...prev, chunkOverlap: overlap }))
  }

  const handleStrategyChange = (value: ChunkingStrategy) => {
    setConfig((prev) => ({ ...prev, chunkingStrategy: value }))
  }

  const handleEnhancedChunkingChange = (checked: boolean) => {
    setConfig((prev) => ({ ...prev, useEnhancedChunking: checked }))
  }

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label className="text-base">Enhanced Chunking</Label>
            <p className="text-sm text-muted-foreground">
              Use advanced recursive character splitting for better context
            </p>
          </div>
          <Switch
            checked={config.useEnhancedChunking}
            onCheckedChange={handleEnhancedChunkingChange}
          />
        </div>

        {config.useEnhancedChunking && (
          <div className="rounded-md bg-muted p-4 text-sm text-muted-foreground">
            <p>
              Enhanced chunking splits text hierarchically (paragraphs →
              sentences → words) to preserve semantic meaning. This is
              recommended for RAG.
            </p>
          </div>
        )}
      </div>

      <div className="space-y-4">
        <div className="flex justify-between">
          <Label>Chunk Size ({chunkSize} tokens)</Label>
        </div>
        <Slider
          value={[chunkSize]}
          min={100}
          max={4000}
          step={100}
          onValueChange={handleChunkSizeChange}
        />
        <p className="text-xs text-muted-foreground">
          Larger chunks provide more context but may dilute specific details.
          Recommended: 500-1000.
        </p>
      </div>

      <div className="space-y-4">
        <div className="flex justify-between">
          <Label>Chunk Overlap ({chunkOverlap} tokens)</Label>
        </div>
        <Slider
          value={[chunkOverlap]}
          min={0}
          max={500}
          step={10}
          onValueChange={handleChunkOverlapChange}
        />
        <p className="text-xs text-muted-foreground">
          Overlap ensures context isn't lost at chunk boundaries. Recommended:
          10-20% of chunk size.
        </p>
      </div>

      {!config.useEnhancedChunking && (
        <div className="space-y-2">
          <Label>Legacy Strategy</Label>
          <Select
            value={config.chunkingStrategy}
            onValueChange={handleStrategyChange}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="fixed">Fixed Size</SelectItem>
              <SelectItem value="semantic">Semantic (Experimental)</SelectItem>
              <SelectItem value="hybrid">Hybrid (Recommended)</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}
    </div>
  )
}
