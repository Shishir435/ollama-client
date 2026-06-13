import { useQueries } from "@tanstack/react-query"

import { DEFAULT_PROVIDER_ID, MESSAGE_KEYS } from "@/lib/constants"
import { getProviderCapabilities } from "@/lib/providers/capabilities"
import { queryKeys } from "@/lib/query-keys"
import { sendRuntimeMessage } from "@/lib/runtime-messages"
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
  enabled: boolean
): Record<string, string[]> => {
  const detailModels = models.filter((m) =>
    Boolean(
      getProviderCapabilities(m.providerId || DEFAULT_PROVIDER_ID)?.modelDetails
    )
  )

  const results = useQueries({
    queries: detailModels.map((m) => {
      const providerId = m.providerId || DEFAULT_PROVIDER_ID
      return {
        queryKey: [...queryKeys.model.info(m.name), providerId || "auto"],
        queryFn: async () => {
          const res = await sendRuntimeMessage(
            MESSAGE_KEYS.PROVIDER.SHOW_MODEL_DETAILS,
            { payload: { model: m.name, providerId } }
          )
          return res?.success ? (res.data ?? null) : null
        },
        enabled,
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
