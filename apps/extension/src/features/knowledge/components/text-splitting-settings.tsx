import { useStorage } from "@plasmohq/storage/hook"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { SettingsFormField, SettingsSwitch } from "@/components/settings"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select"
import { Slider } from "@/components/ui/slider"
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

  const { t } = useTranslation()

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
        <SettingsSwitch
          label={t("model.embedding_config.enhanced_chunking_label")}
          description={t(
            "model.embedding_config.enhanced_chunking_description"
          )}
          checked={config.useEnhancedChunking}
          onCheckedChange={handleEnhancedChunkingChange}
        />

        {config.useEnhancedChunking && (
          <div className="rounded-md bg-muted p-4 text-sm text-muted-foreground">
            <p>{t("model.embedding_config.enhanced_chunking_info")}</p>
          </div>
        )}
      </div>

      <SettingsFormField
        label={`${t("model.embedding_config.chunk_size_label")} (${chunkSize} tokens)`}
        description={t("model.embedding_config.chunk_size_description")}>
        <Slider
          value={[chunkSize]}
          min={100}
          max={4000}
          step={100}
          onValueChange={handleChunkSizeChange}
        />
      </SettingsFormField>

      <SettingsFormField
        label={`${t("model.embedding_config.chunk_overlap_label")} (${chunkOverlap} tokens)`}
        description={t("model.embedding_config.chunk_overlap_description")}>
        <Slider
          value={[chunkOverlap]}
          min={0}
          max={500}
          step={10}
          onValueChange={handleChunkOverlapChange}
        />
      </SettingsFormField>

      {!config.useEnhancedChunking && (
        <SettingsFormField
          label={t("model.embedding_config.chunking_strategy_label")}>
          <Select
            value={config.chunkingStrategy}
            onValueChange={handleStrategyChange}>
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
            </SelectContent>
          </Select>
        </SettingsFormField>
      )}
    </div>
  )
}
