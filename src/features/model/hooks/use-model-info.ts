import { useQuery } from "@tanstack/react-query"

import { MESSAGE_KEYS } from "@/lib/constants"
import { createAppError } from "@/lib/error-utils"
import { logger } from "@/lib/logger"
import { queryKeys } from "@/lib/query-keys"
import { sendRuntimeMessage } from "@/lib/runtime-messages"

export const useModelInfo = (model: string, providerId?: string) => {
  const {
    data: modelInfo = null,
    isLoading: loading,
    error: rawError,
    refetch
  } = useQuery({
    queryKey: [...queryKeys.model.info(model), providerId || "auto"],
    queryFn: async () => {
      const res = await sendRuntimeMessage(
        MESSAGE_KEYS.PROVIDER.SHOW_MODEL_DETAILS,
        {
          payload: {
            model,
            providerId
          }
        }
      )

      if (!res?.success) {
        throw createAppError(
          res?.error?.message || "Failed to fetch model info",
          {
            kind: "provider",
            cause: res?.error
          }
        )
      }

      return res.data ?? null
    },
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
