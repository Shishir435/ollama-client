import { useQueries, useQueryClient } from "@tanstack/react-query"
import { useEffect, useMemo } from "react"
import { fetchModelInfo } from "@/features/model/lib/fetch-model-info"
import { DEFAULT_PROVIDER_ID } from "@/lib/constants"
import { getProviderCapabilities } from "@/lib/providers/capabilities"
import { queryKeys } from "@/lib/query-keys"
import type { ProviderModel } from "@/types"

export const modelTagsKey = (providerId: string, model: string): string =>
  `${providerId}::${model}`

/**
 * Fetches per-model capability tags (Ollama `/api/show` `capabilities[]`) for
 * the models whose provider can self-report them, and returns a map keyed by
 * `${providerId}::${model}`.
 *
 * Only self-reporting providers (Ollama) are queried; everyone else relies on
 * list-time hints + user overrides. Queries are gated on `enabled` (the menu
 * being open) and cached, so opening the menu repeatedly does not re-hit the
 * provider. The query key matches `useModelInfo` so the model-detail panel and
 * this map share one cache entry per model.
 */
export const useModelCapabilityTags = (
  models: ProviderModel[],
  enabled: boolean,
  activeModel?: { model: string; providerId: string } | null
): Record<string, string[]> => {
  const queryClient = useQueryClient()
  const activeKey = activeModel
    ? modelTagsKey(activeModel.providerId, activeModel.model)
    : undefined
  const detailModels = useMemo(
    () =>
      models.filter((m) =>
        Boolean(
          getProviderCapabilities(m.providerId || DEFAULT_PROVIDER_ID)
            ?.modelDetails
        )
      ),
    [models]
  )

  useEffect(() => {
    if (enabled) return
    for (const model of detailModels) {
      if (
        modelTagsKey(model.providerId || DEFAULT_PROVIDER_ID, model.name) ===
        activeKey
      )
        continue
      const queryKey = [
        ...queryKeys.model.info(model.name),
        model.providerId || "auto"
      ]
      const query = queryClient.getQueryCache().find({ queryKey, exact: true })
      // Keep cached capability evidence observable by the sheet. Cancel only
      // work this menu alone owns, without aborting another detail consumer.
      if (
        query?.state.fetchStatus === "fetching" &&
        query.getObserversCount() === 1
      )
        void queryClient
          .cancelQueries({ queryKey, exact: true })
          .catch(() => undefined)
    }
  }, [activeKey, detailModels, enabled, queryClient])

  const results = useQueries({
    queries: detailModels.map((m) => {
      // Mirror `useModelInfo` exactly: key + fetch use the raw provider id (or
      // "auto"/undefined when the model carries none), so the list badges and
      // the detail card share one cache entry instead of splitting on
      // "ollama" vs "auto" for provider-less models.
      return {
        queryKey: [...queryKeys.model.info(m.name), m.providerId || "auto"],
        queryFn: ({ signal }) => fetchModelInfo(m.name, m.providerId, signal),
        enabled:
          enabled ||
          modelTagsKey(m.providerId || DEFAULT_PROVIDER_ID, m.name) ===
            activeKey,
        staleTime: 1000 * 60 * 5
      }
    })
  })

  const map: Record<string, string[]> = {}
  detailModels.forEach((m, i) => {
    const providerId = m.providerId || DEFAULT_PROVIDER_ID
    const data = results[i]?.data as { capabilities?: string[] } | null
    if (data?.capabilities) {
      map[modelTagsKey(providerId, m.name)] = data.capabilities
    }
  })
  return map
}
