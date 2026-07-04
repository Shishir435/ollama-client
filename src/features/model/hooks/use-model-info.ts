import { useQuery } from "@tanstack/react-query"

import { fetchModelInfo } from "@/features/model/lib/fetch-model-info"
import { logger } from "@/lib/logger"
import { queryKeys } from "@/lib/query-keys"

export const useModelInfo = (model: string, providerId?: string) => {
  const {
    data: modelInfo = null,
    isLoading: loading,
    error: rawError,
    refetch
  } = useQuery({
    queryKey: [...queryKeys.model.info(model), providerId || "auto"],
    queryFn: () => fetchModelInfo(model, providerId),
    enabled: !!model,
    // Model details are stable within a session; 5-min stale time avoids
    // redundant background messages when the panel is toggled.
    staleTime: 1000 * 60 * 5
  })

  if (rawError) {
    logger.error("Failed to fetch model info", "useModelInfo", {
      error: rawError
    })
  }

  return {
    modelInfo,
    loading,
    error: rawError ? rawError.message : null,
    refresh: refetch
  }
}
