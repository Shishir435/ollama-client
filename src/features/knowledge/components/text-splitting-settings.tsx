import { useStorage } from "@plasmohq/storage/hook"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { SettingsFormField, SettingsSliderField } from "@/components/settings"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select"
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

  const { t } = useTranslation()
  const safeChunkSize = config.chunkSize ?? DEFAULT_EMBEDDING_CONFIG.chunkSize
  const safeChunkOverlap =
    config.chunkOverlap ?? DEFAULT_EMBEDDING_CONFIG.chunkOverlap

  const [chunkSize, setChunkSize] = useState(safeChunkSize)
  const [chunkOverlap, setChunkOverlap] = useState(safeChunkOverlap)

  // Sync local state with storage
  useEffect(() => {
    setChunkSize(safeChunkSize)
    setChunkOverlap(safeChunkOverlap)
  }, [safeChunkSize, safeChunkOverlap])

  const handleChunkSizeChange = (value: number[]) => {
    const size = value[0] ?? DEFAULT_EMBEDDING_CONFIG.chunkSize
    setChunkSize(size)
    setConfig((prev) => ({
      ...(prev ?? DEFAULT_EMBEDDING_CONFIG),
      chunkSize: size
    }))
  }

  const handleChunkOverlapChange = (value: number[]) => {
    const overlap = value[0] ?? DEFAULT_EMBEDDING_CONFIG.chunkOverlap
    setChunkOverlap(overlap)
    setConfig((prev) => ({
      ...(prev ?? DEFAULT_EMBEDDING_CONFIG),
      chunkOverlap: overlap
    }))
  }

  const handleStrategyChange = (value: ChunkingStrategy) => {
    setConfig((prev) => ({
      ...(prev ?? DEFAULT_EMBEDDING_CONFIG),
      chunkingStrategy: value
    }))
  }

  return (
    <div className="space-y-6">
      <SettingsSliderField
        focusId="chunk-size"
        label={t("model.embedding_config.chunk_size_label")}
        valueLabel={`${chunkSize} tokens`}
        description={t("model.embedding_config.chunk_size_description")}
        value={chunkSize}
        min={100}
        max={4000}
        step={100}
        onValueChange={(value) => handleChunkSizeChange([value])}
      />

      <SettingsSliderField
        focusId="chunk-overlap"
        label={t("model.embedding_config.chunk_overlap_label")}
        valueLabel={`${chunkOverlap} tokens`}
        description={t("model.embedding_config.chunk_overlap_description")}
        value={chunkOverlap}
        min={0}
        max={500}
        step={10}
        onValueChange={(value) => handleChunkOverlapChange([value])}
      />

      <SettingsFormField
        focusId="chunking-strategy"
        label={t("model.embedding_config.chunking_strategy_label")}>
        <Select
          value={config.chunkingStrategy}
          onValueChange={(value) => {
            if (value !== null) handleStrategyChange(value as ChunkingStrategy)
          }}>
          <SelectTrigger>
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
            <SelectItem value="markdown">
              {t("model.embedding_config.strategy_markdown")}
            </SelectItem>
          </SelectContent>
        </Select>
      </SettingsFormField>
    </div>
  )
}
