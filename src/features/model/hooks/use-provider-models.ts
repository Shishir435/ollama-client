import { useStorage } from "@plasmohq/storage/hook"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useCallback, useEffect } from "react"
import { useTranslation } from "react-i18next"

import { DEFAULT_PROVIDER_ID, STORAGE_KEYS } from "@/lib/constants"
import { createAppError } from "@/lib/error-utils"
import { logger } from "@/lib/logger"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"
import { resolveProviderBaseUrl } from "@/lib/providers/base-url"
import { getProviderCapabilities } from "@/lib/providers/capabilities"
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
import { extensionRpcClient } from "@/protocol/extension-client"
import { RpcMethod } from "@/protocol/rpc"
import type { ProviderModel, SelectedModelRef } from "@/types"
import { isEmbeddingModel } from "../lib/model-utils"

const fetchAllProviderModels = async (): Promise<ProviderModel[]> => {
  const result = await extensionRpcClient.call(RpcMethod.ProvidersListModels, {
    enabledOnly: true
  })
  const pairs = result.models
    .filter(
      (model) => model.providerId && model.providerId !== DEFAULT_PROVIDER_ID
    )
    .map((model) => ({
      modelId: model.name,
      providerId: model.providerId as string
    }))
  if (pairs.length > 0) {
    await ProviderManager.saveModelMappings(pairs)
  }
  return result.models
}

const fetchProviderVersion = async (providerId: string): Promise<string> => {
  const provider = await ProviderFactory.getProvider(providerId)
  if (!provider.capabilities.providerVersion) {
    throw createAppError("Version endpoint is not supported by this provider", {
      kind: "provider"
    })
  }

  const baseUrl = resolveProviderBaseUrl(provider.config)

  if (provider.id === ProviderId.OLLAMA) {
    const response = await fetch(`${baseUrl}/api/version`)
    if (!response.ok) {
      throw createAppError("Failed to fetch version", {
        kind: "network",
        retryable: true
      })
    }
    const data = await response.json()
    return data.version as string
  }

  throw createAppError(
    "Version endpoint is not implemented for this provider",
    {
      kind: "provider"
    }
  )
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
  const selectedRefMatchesModel =
    isSelectedModelRef(selectedModelRef) &&
    selectedModelRef.modelId === selectedModel
  const selectedProviderId =
    (selectedRefMatchesModel ? selectedModelRef.providerId : undefined) ||
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
      logger.error(
        "Failed to migrate selected model reference",
        "useProviderModels",
        { error }
      )
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

  const refresh = useCallback(async () => {
    const result = await refetchModels()
    await queryClientInstance.invalidateQueries({
      queryKey: queryKeys.model.infoAll()
    })
    return result
  }, [queryClientInstance, refetchModels])

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
        throw createAppError("Model delete is not supported by this provider", {
          kind: "provider"
        })
      }

      if (provider.id === DEFAULT_PROVIDER_ID) {
        const baseUrl = resolveProviderBaseUrl(provider.config)
        const response = await fetch(`${baseUrl}/api/delete`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: modelName })
        })
        if (!response.ok) {
          throw createAppError("Failed to delete model", {
            kind: "network",
            retryable: true
          })
        }
        return
      }

      throw createAppError(
        "Model delete endpoint is not configured for this provider",
        {
          kind: "provider"
        }
      )
    },
    onSuccess: () => {
      queryClientInstance.invalidateQueries({
        queryKey: queryKeys.model.providerList()
      })
    },
    onError: (err) => {
      logger.error("Error deleting model", "useProviderModels", { error: err })
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
    return getProviderCapabilities(selectedProviderId)
  })()
  const isOllama = selectedProviderId === DEFAULT_PROVIDER_ID

  const versionError = versionRawError ? "Failed to connect to provider" : null

  return {
    models,
    selectedModel,
    selectedModelRef: selectedRefMatchesModel ? selectedModelRef : null,
    setSelectedModel: persistSelectedModel,
    selectionConflictModel,
    clearSelectionConflict: () => setSelectionConflictModel(null),
    isLoading,
    error,
    refresh,
    status,
    version: isOllama ? version : null,
    versionError,
    deleteModel,
    selectedProviderId,
    selectedProviderCapabilities
  }
}
