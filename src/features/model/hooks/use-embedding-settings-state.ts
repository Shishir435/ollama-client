import { useCallback, useEffect, useMemo } from "react"

import { useSetting } from "@/hooks/use-setting"
import {
  DEFAULT_EMBEDDING_CONFIG,
  DEFAULT_PROVIDER_ID,
  type EmbeddingConfig
} from "@/lib/constants"
import {
  isLikelyEmbeddingModelName,
  recommendedEmbeddingBaseSet
} from "@/lib/embeddings/model-name-filter"
import { SETTINGS } from "@/lib/storage/settings"

import { useEmbeddingModelCheck } from "./use-embedding-model-check"
import { useProviderModels } from "./use-provider-models"

/**
 * Storage-backed model and configuration state for the embeddings screen.
 * Keeps provider discovery and the selected-model compatibility setting out of
 * the settings-page composition component.
 */
export const useEmbeddingSettingsState = () => {
  const [selectedModel, setSelectedModel] = useSetting(
    SETTINGS.EMBEDDING_SELECTED_MODEL
  )
  const [storedConfig, setConfig] = useSetting(SETTINGS.EMBEDDING_CONFIG)
  const [memoryEnabled] = useSetting(SETTINGS.MEMORY_ENABLED)
  const { models } = useProviderModels()
  const config = storedConfig || DEFAULT_EMBEDDING_CONFIG

  useEffect(() => {
    if (
      storedConfig?.sharedEmbeddingModel &&
      storedConfig.sharedEmbeddingModel !== selectedModel
    ) {
      setSelectedModel(storedConfig.sharedEmbeddingModel)
    }
  }, [selectedModel, setSelectedModel, storedConfig?.sharedEmbeddingModel])

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
      setConfig((previous) => ({
        ...DEFAULT_EMBEDDING_CONFIG,
        ...previous,
        ...updates
      }))
    },
    [setConfig]
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

  const normalizeSelectedModel = useCallback(
    (model: string) =>
      applyModelChange(
        model,
        config.sharedEmbeddingProviderId || DEFAULT_PROVIDER_ID
      ),
    [applyModelChange, config.sharedEmbeddingProviderId]
  )

  const modelExists = useEmbeddingModelCheck({
    selectedModel,
    setSelectedModel: normalizeSelectedModel,
    providerId: config.sharedEmbeddingProviderId || DEFAULT_PROVIDER_ID
  })

  return {
    selectedModel,
    config,
    memoryEnabled,
    embeddingModels,
    hasAdvancedModels,
    modelExists,
    updateConfig,
    applyModelChange
  }
}
