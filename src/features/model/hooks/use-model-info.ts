import { useCallback, useEffect, useState } from "react"

import { browser } from "@/lib/browser-api"
import { MESSAGE_KEYS } from "@/lib/constants"
import { logger } from "@/lib/logger"
import type { ChromeResponse, OllamaShowResponse } from "@/types"

export const useModelInfo = (model: string) => {
  const [modelInfo, setModelInfo] = useState<OllamaShowResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!model) return
    setLoading(true)
    setError(null)

    try {
      const res = (await browser.runtime.sendMessage({
        type: MESSAGE_KEYS.OLLAMA.SHOW_MODEL_DETAILS,
        payload: model
      })) as ChromeResponse & { data?: OllamaShowResponse }
      if (res?.success) {
        setModelInfo(res.data ?? null)
      } else {
        setError("Failed to fetch model info")
      }
    } catch (error) {
      logger.error("Failed to fetch model info", "useModelInfo", { error })
      setError("Failed to fetch model info")
    } finally {
      setLoading(false)
    }
  }, [model])

  useEffect(() => {
    if (!model) return
    refresh()
  }, [model, refresh])

  return { modelInfo, loading, error, refresh }
}
