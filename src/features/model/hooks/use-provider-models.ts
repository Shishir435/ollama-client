import { useStorage } from "@plasmohq/storage/hook"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect } from "react"
import { useTranslation } from "react-i18next"

import { DEFAULT_PROVIDER_ID, STORAGE_KEYS } from "@/lib/constants"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"
import { ProviderFactory } from "@/lib/providers/factory"
import { ProviderManager } from "@/lib/providers/manager"
import { type ProviderConfig, ProviderStorageKey } from "@/lib/providers/types"
import { queryKeys } from "@/lib/query-keys"
import type { ProviderModel } from "@/types"
import { isEmbeddingModel } from "../lib/model-utils"

const fetchAllProviderModels = async (): Promise<ProviderModel[]> => {
  const providers = await ProviderManager.getProviders()
  const enabledProviders = providers.filter((p) => p.enabled)
  console.log(
    "[useProviderModels] Enabled providers:",
    enabledProviders.map((p) => p.id)
  )

  const allModels: ProviderModel[] = []

  await Promise.all(
    enabledProviders.map(async (config) => {
      try {
        console.log(`[useProviderModels] Fetching for ${config.id}...`)
        const provider = await ProviderFactory.getProvider(config.id)
        const providerModels = await provider.getModels()
        const customs = config.customModels || []

        const modelMap = new Map<string, ProviderModel>()
        providerModels.forEach((m) => {
          modelMap.set(m.name, m)
        })

        customs.forEach((name) => {
          if (!modelMap.has(name)) {
            modelMap.set(name, {
              name,
              model: name,
              modified_at: new Date().toISOString(),
              size: 0,
              digest: config.id,
              providerId: config.id,
              providerName: config.name,
              details: {
                parent_model: "",
                format: "gguf",
                family: config.type,
                families: [],
                parameter_size: "",
                quantization_level: ""
              }
            })
          }
        })

        modelMap.forEach((model) => {
          if (!model.providerId) model.providerId = config.id
          if (!model.providerName) model.providerName = config.name
          allModels.push(model)
        })
      } catch (e) {
        console.error(`Failed to fetch models for ${config.id}`, e)
      }
    })
  )

  // Persist model→provider mappings so the background script can route correctly.
  // On collision (same model name from multiple providers), the first one wins.
  const mappings: Record<string, string> = {}
  allModels.forEach((m) => {
    if (m.providerId && m.providerId !== DEFAULT_PROVIDER_ID) {
      if (mappings[m.name]) {
        console.warn(
          `[useProviderModels] Model name collision: "${m.name}" is served by both "${mappings[m.name]}" and "${m.providerId}". Keeping first mapping.`
        )
      } else {
        mappings[m.name] = m.providerId
      }
    }
  })
  if (Object.keys(mappings).length > 0) {
    await ProviderManager.saveModelMappings(mappings)
  }

  allModels.sort((a, b) => a.name.localeCompare(b.name))
  return allModels
}

const fetchOllamaVersion = async (): Promise<string> => {
  const config = await ProviderManager.getProviderConfig(DEFAULT_PROVIDER_ID)
  const baseUrl = config?.baseUrl || "http://localhost:11434"

  const response = await fetch(`${baseUrl}/api/version`)
  if (!response.ok) throw new Error("Failed to fetch version")
  const data = await response.json()
  return data.version as string
}

/**
 * Hook for managing provider models, including fetching, selecting, and deleting.
 */

export const useProviderModels = () => {
  const { t } = useTranslation()
  const queryClientInstance = useQueryClient()

  const [selectedModel, setSelectedModel, { isLoading: isStorageLoading }] =
    useStorage<string>(
      {
        key: STORAGE_KEYS.PROVIDER.SELECTED_MODEL,
        instance: plasmoGlobalStorage
      },
      ""
    )
  const [providerConfig] = useStorage<ProviderConfig[]>(
    { key: ProviderStorageKey.CONFIG, instance: plasmoGlobalStorage },
    []
  )

  /**
   * Model list query — refetches whenever providerConfig changes
   */
  const {
    data: models = [],
    isFetching: isLoading,
    error: modelsError,
    refetch: refetchModels
  } = useQuery({
    queryKey: [...queryKeys.model.providerList(), providerConfig],
    queryFn: fetchAllProviderModels,
    // 30-second stale time; the list rarely changes mid-session.
    staleTime: 1000 * 30
  })

  // Fallback: If no model is selected but models are available, pick the first one.
  // This ensures the UI doesn't drop into a "no model selected" state on first load.
  // We only run this if the storage has finished loading to prevent race conditions.
  // We deliberately avoid overwriting if selectedModel already has a value, even if it's
  // missing from the current generic list, to prevent losing user preference due to
  // transient provider fetch delays.
  useEffect(() => {
    if (isStorageLoading || models.length === 0) return

    if (!selectedModel) {
      const firstChatModel = models.find(
        (m) => !isEmbeddingModel(m.name, m.details?.families || [])
      )
      if (firstChatModel) {
        setSelectedModel(firstChatModel.name)
      }
    }
  }, [selectedModel, models, isStorageLoading, setSelectedModel])

  /**
   * Ollama version query
   */
  const { data: version = null, error: versionRawError } = useQuery({
    queryKey: queryKeys.model.providerVersion(),
    queryFn: fetchOllamaVersion,
    staleTime: 1000 * 60 * 5,
    retry: false
  })

  /**
   * Delete mutation — invalidates the model list on success
   */
  const { mutateAsync: deleteModel } = useMutation({
    mutationFn: async (modelName: string) => {
      const config =
        await ProviderManager.getProviderConfig(DEFAULT_PROVIDER_ID)
      const baseUrl = config?.baseUrl || "http://localhost:11434"

      const response = await fetch(`${baseUrl}/api/delete`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: modelName })
      })

      if (!response.ok) throw new Error("Failed to delete model")
    },
    onSuccess: () => {
      queryClientInstance.invalidateQueries({
        queryKey: queryKeys.model.providerList()
      })
    },
    onError: (err) => {
      console.error("Error deleting model:", err)
    }
  })

  const error = modelsError ? t("errors.failed_to_fetch_models") : null

  const status = isLoading
    ? "loading"
    : error
      ? "error"
      : models.length === 0
        ? "empty"
        : "ready"

  const selectedModelData = models.find((m) => m.name === selectedModel)
  const isOllama =
    !selectedModel ||
    !selectedModelData ||
    selectedModelData.providerId === DEFAULT_PROVIDER_ID

  const versionError = versionRawError ? "Failed to connect to provider" : null

  return {
    models,
    selectedModel,
    setSelectedModel,
    isLoading,
    error,
    refresh: refetchModels,
    status,
    version: isOllama ? version : null,
    versionError,
    deleteModel
  }
}
