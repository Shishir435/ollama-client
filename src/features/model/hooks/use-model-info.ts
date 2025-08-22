import { useCallback, useEffect, useState } from "react"

import { MESSAGE_KEYS } from "@/lib/constants"

export const useModelInfo = (model: string) => {
  const [modelInfo, setModelInfo] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(() => {
    if (!model) return
    setLoading(true)
    setError(null)

    chrome.runtime.sendMessage(
      { type: MESSAGE_KEYS.OLLAMA.SHOW_MODEL_DETAILS, payload: model },
      (res) => {
        if (res?.success) {
          setModelInfo(res.data)
        } else {
          setError("Failed to fetch model info")
        }
        setLoading(false)
      }
    )
  }, [model])

  useEffect(() => {
    if (!model) return
    refresh()
  }, [model, refresh])

  return { modelInfo, loading, error, refresh }
}
