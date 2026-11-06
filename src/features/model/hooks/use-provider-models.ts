import {
  MODEL_DISCOVERY_FAILURE,
  type ProvidersListModelsResult
} from "@ollama-client/contracts/provider-rpc"
import { RpcMethod } from "@ollama-client/contracts/rpc"
import { useStorage } from "@plasmohq/storage/hook"
import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient
} from "@tanstack/react-query"
import { useCallback, useEffect, useMemo } from "react"
import { useTranslation } from "react-i18next"
import { useSetting } from "@/hooks/use-setting"
import { DEFAULT_PROVIDER_ID } from "@/lib/constants"
import { createAppError, isAppError } from "@/lib/error-utils"
import { logger } from "@/lib/logger"
import { plasmoSyncStorage } from "@/lib/plasmo-global-storage"
import { resolveProviderBaseUrl } from "@/lib/providers/base-url"
import { getProviderCapabilities } from "@/lib/providers/capabilities"
import { ProviderFactory } from "@/lib/providers/factory"
import { ProviderManager } from "@/lib/providers/manager"
import { isLocalProviderBaseUrl } from "@/lib/providers/provider-errors"
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
import { SETTINGS } from "@/lib/storage/settings"
import { extensionRpcClient } from "@/protocol/extension-client"
import {
  catalogStaleTimeMs,
  normalizeCatalogRefreshMs
} from "../lib/catalog-refresh"
import { isEmbeddingModel } from "../lib/model-utils"
import { UNVERIFIED_PROVIDER_CODE } from "../lib/provider-catalog-codes"

/**
 * Stable identities: a fresh literal on every render would restart the effects
 * and memos that take `models`.
 */
const EMPTY_MODELS: ProvidersListModelsResult["models"] = []
const EMPTY_FAILURES: ProvidersListModelsResult["failures"] = []

/**
 * What one enabled provider's own catalog query has established. Each status
 * is about that provider alone: a failure elsewhere never moves it.
 *
 * - `checking` — no answer yet.
 * - `unverified` — the question never reached the provider (an extension
 *   transport failure or timeout), so nothing is known about it.
 * - `request_failed` — the background asked and nothing answered.
 * - `listed` — the background answered; `failureCode` carries a partial
 *   failure the answer reported, `modelNames` what it listed (declared ids
 *   included) and `discoveredNames` the subset the server itself returned.
 */
export type ProviderCatalogState =
  | { status: "checking" }
  | { status: "unverified" }
  | { status: "request_failed" }
  | {
      status: "listed"
      failureCode: string | null
      /** Every id listed, declared ones included. */
      modelNames: ReadonlySet<string>
      /** Only the ids the server itself returned. */
      discoveredNames: ReadonlySet<string>
    }

export interface ProviderCatalog {
  providerId: string
  providerName: string
  state: ProviderCatalogState
}

/**
 * Whether a catalog query's error is the background's own verdict that the
 * provider did not answer. `ProvidersListModels` for one provider throws only
 * when discovery failed and nothing covered for it; a transport failure or
 * timeout is `network`, and a vanished config is a 404 — neither says
 * anything about the provider's server.
 */
const isConfirmedDiscoveryFailure = (error: unknown): boolean =>
  isAppError(error) && error.kind === "provider" && error.status !== 404

const catalogState = (query: {
  data?: ProvidersListModelsResult
  error: unknown
}): ProviderCatalogState => {
  if (query.error) {
    return isConfirmedDiscoveryFailure(query.error)
      ? { status: "request_failed" }
      : { status: "unverified" }
  }
  if (!query.data) return { status: "checking" }
  return {
    status: "listed",
    failureCode: query.data.failures[0]?.code ?? null,
    modelNames: new Set(query.data.models.map((model) => model.name)),
    discoveredNames: new Set(
      query.data.models
        .filter((model) => !model.declared)
        .map((model) => model.name)
    )
  }
}

/**
 * Merge the per-provider queries into the one list the UI consumes.
 *
 * Declared at module scope so its identity is stable: `useQueries` re-runs
 * `combine` whenever the function changes, and an inline closure would rebuild
 * the model array on every render, restarting every effect that takes it.
 */
const combineProviderModels = (
  results: ReadonlyArray<{
    data?: ProvidersListModelsResult
    isFetching: boolean
    error: unknown
  }>
) => {
  /** Per query, in the order the queries were declared. */
  const catalogs = results.map(catalogState)
  const models: ProvidersListModelsResult["models"] = []
  const failures: ProvidersListModelsResult["failures"] = []
  let isFetching = false
  let error: unknown = null

  for (const result of results) {
    if (result.data) {
      models.push(...result.data.models)
      failures.push(...result.data.failures)
    }
    if (result.isFetching) isFetching = true
    if (!error && result.error) error = result.error
  }

  return {
    models: models.length > 0 ? models : EMPTY_MODELS,
    failures: failures.length > 0 ? failures : EMPTY_FAILURES,
    isFetching,
    error,
    catalogs
  }
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

const migrateLegacyModelSelection = async ({
  legacyModelId,
  models,
  persistSelectedModel,
  setSelectionConflictModel
}: {
  legacyModelId: string
  models: ProvidersListModelsResult["models"]
  persistSelectedModel: (modelId: string, providerId?: string) => Promise<void>
  setSelectionConflictModel: (value: string | null) => void
}): Promise<void> => {
  const resolved = resolveModelRefFromModels(legacyModelId, models)
  if (resolved.ref) {
    await persistSelectedModel(resolved.ref.modelId, resolved.ref.providerId)
    setSelectionConflictModel(null)
    return
  }
  if (resolved.ambiguous) {
    setSelectionConflictModel(legacyModelId)
    return
  }

  const mapping = await ProviderManager.getModelMapping(legacyModelId)
  if (!mapping?.providerId) return
  await persistSelectedModel(legacyModelId, mapping.providerId)
  setSelectionConflictModel(null)
}

/**
 * Hook for managing provider models, including fetching, selecting, and deleting.
 */
export const useProviderModels = () => {
  const { t } = useTranslation()
  const queryClientInstance = useQueryClient()

  const [selectedModel, setSelectedModel, { isLoading: isStorageLoading }] =
    useSetting(SETTINGS.SELECTED_MODEL)
  const [selectedModelRef, setSelectedModelRef] = useSetting(
    SETTINGS.SELECTED_MODEL_REF
  )
  const [selectionConflictModel, setSelectionConflictModel] = useSetting(
    SETTINGS.SELECTION_CONFLICT_MODEL
  )
  const [providerConfig] = useStorage<ProviderConfig[]>(
    { key: ProviderStorageKey.CONFIG, instance: plasmoSyncStorage },
    []
  )
  const [storedCatalogRefreshMs] = useSetting(
    SETTINGS.PROVIDER_CATALOG_REFRESH_MS
  )
  const catalogRefreshMs = normalizeCatalogRefreshMs(storedCatalogRefreshMs)

  /*
   * Who to ask, from the background rather than from `providerConfig` directly:
   * `getProviders` merges the built-ins into stored configuration, so a profile
   * whose storage has not been written yet would otherwise fan out to nobody.
   * The stored array stays in the key as the change signal — a storage-only
   * read, so re-running it costs nothing.
   */
  const {
    data: providerList,
    isFetching: isLoadingProviders,
    error: providersError
  } = useQuery({
    queryKey: [...queryKeys.model.providerConfigs(), providerConfig],
    queryFn: () => extensionRpcClient.call(RpcMethod.ProvidersList, {}),
    staleTime: 1000 * 30
  })

  const enabledProviders = useMemo(
    () =>
      (providerList?.providers ?? []).filter((provider) => provider.enabled),
    [providerList]
  )

  /*
   * One query per provider, keyed by that provider's own configuration. Editing
   * one provider therefore re-discovers that provider only: everyone else's key
   * is unchanged and answers from cache. A single list keyed by the whole config
   * array meant adding one model id to one provider re-ran discovery against
   * every endpoint, which for a hosted router is a real request against someone
   * else's rate limit.
   */
  const {
    models,
    failures,
    isFetching: isLoadingModels,
    error: modelQueryError,
    catalogs
  } = useQueries({
    queries: enabledProviders.map((provider) => ({
      queryKey: [...queryKeys.model.providerModels(provider.id), provider],
      queryFn: () =>
        extensionRpcClient.call(RpcMethod.ProvidersListModels, {
          providerId: provider.id
        }),
      staleTime: catalogStaleTimeMs(catalogRefreshMs),
      /**
       * Only a provider on this machine is polled: a pulled model shows up
       * without a click. A remote catalog refreshes when stale on open and on
       * demand, never on a timer against someone else's rate limit.
       */
      refetchInterval:
        catalogRefreshMs > 0 &&
        (provider.id === ProviderId.BROWSER ||
          isLocalProviderBaseUrl(provider.baseUrl))
          ? catalogRefreshMs
          : (false as const)
    })),
    combine: combineProviderModels
  })

  const isLoading = isLoadingProviders || isLoadingModels
  const modelsError = providersError ?? modelQueryError

  const providerCatalogs = useMemo(
    () =>
      Object.fromEntries(
        enabledProviders.map((provider, index): [string, ProviderCatalog] => [
          provider.id,
          {
            providerId: provider.id,
            providerName: provider.name,
            state: catalogs[index] ?? { status: "checking" }
          }
        ])
      ) as Record<string, ProviderCatalog>,
    [enabledProviders, catalogs]
  )

  /**
   * A provider whose discovery failed outright throws instead of answering,
   * so it never appears in `failures`; it is added here so the menu can still
   * name it, show it in the rail and offer a retry.
   */
  const unavailableProviders = useMemo(
    () => [
      /*
       * A failed refetch keeps the previous answer's data, and with it a
       * failure entry that no longer describes the provider; the current
       * catalog state wins over it.
       */
      ...failures.filter(
        (failure) =>
          failure.code !== MODEL_DISCOVERY_FAILURE.DISCOVERY_UNAVAILABLE &&
          providerCatalogs[failure.providerId]?.state.status !==
            "request_failed"
      ),
      ...Object.values(providerCatalogs)
        .filter((catalog) => catalog.state.status === "request_failed")
        .map((catalog) => ({
          providerId: catalog.providerId,
          providerName: catalog.providerName,
          code: MODEL_DISCOVERY_FAILURE.REQUEST_FAILED as string
        }))
    ],
    [failures, providerCatalogs]
  )

  /**
   * Providers whose question never got an answer (a timeout or transport
   * failure). Nothing is known about them, so they are not failures, but one
   * with no cached models would otherwise vanish from the menu with no retry.
   */
  const unverifiedProviders = useMemo(
    () =>
      Object.values(providerCatalogs)
        .filter((catalog) => catalog.state.status === "unverified")
        .map((catalog) => ({
          providerId: catalog.providerId,
          providerName: catalog.providerName,
          code: UNVERIFIED_PROVIDER_CODE as string
        })),
    [providerCatalogs]
  )

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
      if (isSelectedModelRef(selectedModelRef)) {
        if (selectedModel !== selectedModelRef.modelId) {
          await setSelectedModel(selectedModelRef.modelId)
        }
        if (selectionConflictModel) await setSelectionConflictModel(null)
        return
      }

      if (!selectedModel) {
        const firstChatModel = models.find(
          (model) =>
            !isEmbeddingModel(model.name, model.details?.families || [])
        )
        if (firstChatModel?.providerId) {
          await persistSelectedModel(
            firstChatModel.name,
            firstChatModel.providerId
          )
        }
        return
      }

      await migrateLegacyModelSelection({
        legacyModelId: selectedModel,
        models,
        persistSelectedModel,
        setSelectionConflictModel
      })
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

  const { data: version = null, error: versionRawError } = useQuery({
    queryKey: [...queryKeys.model.providerVersion(), selectedProviderId],
    queryFn: () => fetchProviderVersion(selectedProviderId),
    enabled: selectedProviderId === ProviderId.OLLAMA,
    staleTime: 1000 * 60 * 5,
    retry: false
  })

  const refresh = useCallback(async () => {
    await queryClientInstance.invalidateQueries({
      queryKey: queryKeys.model.providerConfigs()
    })
    await queryClientInstance.refetchQueries({
      queryKey: queryKeys.model.providerList()
    })
    await queryClientInstance.invalidateQueries({
      queryKey: queryKeys.model.infoAll()
    })
  }, [queryClientInstance])

  /** One provider's catalog, for a change only that provider reads. */
  const refreshProvider = useCallback(
    (providerId: string) =>
      queryClientInstance.refetchQueries({
        queryKey: queryKeys.model.providerModels(providerId)
      }),
    [queryClientInstance]
  )

  /**
   * Every catalog whose cache has gone stale, for the model menu opening.
   * Remote catalogs are not polled, so without this a model added while the
   * panel stayed open would be missing until a manual refresh.
   */
  const refreshStale = useCallback(
    () =>
      queryClientInstance.refetchQueries({
        queryKey: queryKeys.model.providerModelLists(),
        stale: true,
        type: "active"
      }),
    [queryClientInstance]
  )

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

      // The adapter owns the wire format; the page only names the model.
      const { deleted } = await extensionRpcClient.call(
        RpcMethod.ModelsDelete,
        { model: modelName, providerId }
      )
      if (!deleted) {
        throw createAppError("Model delete is not supported by this provider", {
          kind: "provider"
        })
      }
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
    refreshProvider,
    refreshStale,
    status,
    version: isOllama ? version : null,
    versionError,
    deleteModel,
    selectedProviderId,
    selectedProviderCapabilities,
    /** The selected model's provider endpoint, for where-does-text-go notices. */
    selectedProviderBaseUrl:
      enabledProviders.find((provider) => provider.id === selectedProviderId)
        ?.baseUrl ?? "",
    unavailableProviders,
    unverifiedProviders,
    /** Each enabled provider's own catalog answer, keyed by provider id. */
    providerCatalogs,
    /** False until the enabled-provider list itself has been read. */
    providersKnown: providerList !== undefined,
    /** Whether Ollama is on, so a menu can offer it before it lists a model. */
    ollamaEnabled: enabledProviders.some(
      (provider) => provider.id === DEFAULT_PROVIDER_ID
    )
  }
}
