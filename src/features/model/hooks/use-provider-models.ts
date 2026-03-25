import { useStorage } from "@plasmohq/storage/hook"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useCallback, useEffect } from "react"
import { useTranslation } from "react-i18next"

import { DEFAULT_PROVIDER_ID, STORAGE_KEYS } from "@/lib/constants"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"
import { ProviderFactory } from "@/lib/providers/factory"
import { ProviderManager } from "@/lib/providers/manager"
import {
  isSelectedModelRef,
  resolveModelRefFromModels,
  saveSelectedModelRef
} from "@/lib/providers/selected-model"
import {
  type ProviderCapabilities,
  type ProviderConfig,
  ProviderId,
  ProviderStorageKey
} from "@/lib/providers/types"
import { queryKeys } from "@/lib/query-keys"
import type { ProviderModel, SelectedModelRef } from "@/types"
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

const fetchProviderVersion = async (providerId: string): Promise<string> => {
  const provider = await ProviderFactory.getProvider(providerId)
  if (!provider.capabilities.providerVersion) {
    throw new Error("Version endpoint is not supported by this provider")
  }

  const baseUrl = provider.config.baseUrl || "http://localhost:11434"

  if (provider.id === ProviderId.OLLAMA) {
    const response = await fetch(`${baseUrl}/api/version`)
    if (!response.ok) throw new Error("Failed to fetch version")
    const data = await response.json()
    return data.version as string
  }

  throw new Error("Version endpoint is not implemented for this provider")
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
  const [selectedModelRef, setSelectedModelRef] =
    useStorage<SelectedModelRef | null>(
      {
        key: STORAGE_KEYS.PROVIDER.SELECTED_MODEL_REF,
        instance: plasmoGlobalStorage
      },
      null
    )
  const [selectionConflictModel, setSelectionConflictModel] = useStorage<
    string | null
  >(
    {
      key: STORAGE_KEYS.PROVIDER.SELECTION_CONFLICT_MODEL,
      instance: plasmoGlobalStorage
    },
    null
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

  const selectedModelData = models.find((m) => m.name === selectedModel)
  const selectedProviderId =
    selectedModelRef?.providerId ||
    selectedModelData?.providerId ||
    DEFAULT_PROVIDER_ID

  const persistSelectedModel = useCallback(
    async (modelId: string, providerId?: string) => {
      const provider =
        providerId ||
        models.find((m) => m.name === modelId)?.providerId ||
        DEFAULT_PROVIDER_ID
      await saveSelectedModelRef({ providerId: provider, modelId })
      await setSelectedModel(modelId)
      await setSelectedModelRef({ providerId: provider, modelId })
    },
    [models, setSelectedModel, setSelectedModelRef]
  )

  useEffect(() => {
    if (isStorageLoading || models.length === 0) return

    const runMigration = async () => {
      const refIsValid = isSelectedModelRef(selectedModelRef)

      if (refIsValid) {
        // Keep legacy key in sync during compatibility window.
        if (selectedModel !== selectedModelRef.modelId) {
          await setSelectedModel(selectedModelRef.modelId)
        }
        if (selectionConflictModel) {
          await setSelectionConflictModel(null)
        }
        return
      }

      const legacyModelId = selectedModel
      if (!legacyModelId) {
        const firstChatModel = models.find(
          (m) => !isEmbeddingModel(m.name, m.details?.families || [])
        )
        if (firstChatModel?.providerId) {
          await persistSelectedModel(
            firstChatModel.name,
            firstChatModel.providerId
          )
        }
        return
      }

      const resolved = resolveModelRefFromModels(legacyModelId, models)

      if (resolved.ref) {
        await persistSelectedModel(
          resolved.ref.modelId,
          resolved.ref.providerId
        )
        await setSelectionConflictModel(null)
        return
      }

      if (resolved.ambiguous) {
        await setSelectionConflictModel(legacyModelId)
        return
      }

      const mapping = await ProviderManager.getModelMapping(legacyModelId)
      if (mapping?.providerId) {
        await persistSelectedModel(legacyModelId, mapping.providerId)
        await setSelectionConflictModel(null)
      }
    }
    runMigration().catch((error) => {
      console.error("Failed to migrate selected model reference", error)
    })
  }, [
    isStorageLoading,
    models,
    persistSelectedModel,
    selectedModel,
    selectedModelRef,
    selectionConflictModel,
    setSelectedModel,
    setSelectionConflictModel
  ])

  /**
   * Ollama version query
   */
  const { data: version = null, error: versionRawError } = useQuery({
    queryKey: [...queryKeys.model.providerVersion(), selectedProviderId],
    queryFn: () => fetchProviderVersion(selectedProviderId),
    enabled: selectedProviderId === ProviderId.OLLAMA,
    staleTime: 1000 * 60 * 5,
    retry: false
  })

  /**
   * Delete mutation — invalidates the model list on success
   */
  const { mutateAsync: deleteModel } = useMutation({
    mutationFn: async (
      target: { modelName: string; providerId?: string } | string
    ) => {
      const modelName = typeof target === "string" ? target : target.modelName
      const providerId =
        (typeof target === "string" ? undefined : target.providerId) ||
        models.find((m) => m.name === modelName)?.providerId ||
        selectedModelRef?.providerId ||
        DEFAULT_PROVIDER_ID

      const provider = await ProviderFactory.getProvider(providerId)
      if (!provider.capabilities.modelDelete) {
        throw new Error("Model delete is not supported by this provider")
      }

      if (provider.id === DEFAULT_PROVIDER_ID) {
        const baseUrl = provider.config.baseUrl || "http://localhost:11434"
        const response = await fetch(`${baseUrl}/api/delete`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: modelName })
        })
        if (!response.ok) throw new Error("Failed to delete model")
        return
      }

      throw new Error(
        "Model delete endpoint is not configured for this provider"
      )
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

  const selectedProviderCapabilities: ProviderCapabilities | null = (() => {
    const capByProviderId: Record<string, ProviderCapabilities> = {
      [ProviderId.OLLAMA]: {
        chat: true,
        embeddings: true,
        modelDiscovery: true,
        modelDetails: true,
        modelPull: true,
        modelUnload: true,
        modelDelete: true,
        providerVersion: true,
        toolCalling: false
      },
      [ProviderId.LM_STUDIO]: {
        chat: true,
        embeddings: true,
        modelDiscovery: true,
        modelDetails: false,
        modelPull: true,
        modelUnload: true,
        modelDelete: false,
        providerVersion: false,
        toolCalling: true
      },
      [ProviderId.LLAMA_CPP]: {
        chat: true,
        embeddings: true,
        modelDiscovery: true,
        modelDetails: false,
        modelPull: false,
        modelUnload: false,
        modelDelete: false,
        providerVersion: false,
        toolCalling: true
      },
      [ProviderId.VLLM]: {
        chat: true,
        embeddings: true,
        modelDiscovery: true,
        modelDetails: false,
        modelPull: false,
        modelUnload: false,
        modelDelete: false,
        providerVersion: false,
        toolCalling: true
      },
      [ProviderId.LOCALAI]: {
        chat: true,
        embeddings: true,
        modelDiscovery: true,
        modelDetails: false,
        modelPull: false,
        modelUnload: false,
        modelDelete: false,
        providerVersion: false,
        toolCalling: true
      },
      [ProviderId.KOBOLDCPP]: {
        chat: true,
        embeddings: true,
        modelDiscovery: true,
        modelDetails: false,
        modelPull: false,
        modelUnload: false,
        modelDelete: false,
        providerVersion: false,
        toolCalling: true
      }
    }

    return capByProviderId[selectedProviderId] || null
  })()
  const isOllama = selectedProviderId === DEFAULT_PROVIDER_ID

  const versionError = versionRawError ? "Failed to connect to provider" : null

  return {
    models,
    selectedModel,
    selectedModelRef: isSelectedModelRef(selectedModelRef)
      ? selectedModelRef
      : null,
    setSelectedModel: persistSelectedModel,
    selectionConflictModel,
    clearSelectionConflict: () => setSelectionConflictModel(null),
    isLoading,
    error,
    refresh: refetchModels,
    status,
    version: isOllama ? version : null,
    versionError,
    deleteModel,
    selectedProviderId,
    selectedProviderCapabilities
  }
}
