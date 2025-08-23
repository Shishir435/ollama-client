import { useEffect, useState } from "react"

import { MESSAGE_KEYS } from "@/lib/constants"
import type { OllamaModel } from "@/types"

export const useOllamaModels = () => {
  const [models, setModels] = useState<OllamaModel[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState<boolean>(true)

  const [version, setVersion] = useState<string | null>(null)
  const [versionError, setVersionError] = useState<string | null>(null)

  const fetchModels = () => {
    setLoading(true)
    chrome.runtime.sendMessage(
      { type: MESSAGE_KEYS.OLLAMA.GET_MODELS },
      (response) => {
        if (response?.success) {
          setModels(response.data.models ?? [])
          setError(null)
        } else {
          setError(
            "Failed to fetch models. Ensure Ollama is running or check the base URL."
          )
          setModels(null)
        }
        setLoading(false)
      }
    )
  }

  const deleteModel = (modelName: string) => {
    chrome.runtime.sendMessage(
      {
        type: MESSAGE_KEYS.OLLAMA.DELETE_MODEL,
        payload: modelName
      },
      (response) => {
        if (response?.success) {
          // Optimistically update local state
          setModels((prev) =>
            prev ? prev.filter((model) => model.name !== modelName) : null
          )
        } else {
          console.error(
            `Failed to delete model "${modelName}":`,
            response?.error?.message
          )
        }
      }
    )
  }

  const fetchOllamaVersion = () => {
    chrome.runtime.sendMessage(
      { type: MESSAGE_KEYS.OLLAMA.GET_OLLAMA_VERSION },
      (response) => {
        if (response?.success) {
          setVersion(response.data.version)
          setVersionError(null)
        } else {
          setVersionError("Failed to fetch Ollama version.")
          setVersion(null)
        }
      }
    )
  }

  useEffect(() => {
    fetchModels()
    fetchOllamaVersion()
  }, [])

  const status: "loading" | "error" | "empty" | "ready" = loading
    ? "loading"
    : error
      ? "error"
      : !models || models.length === 0
        ? "empty"
        : "ready"

  return {
    models,
    error,
    loading,
    status,
    refresh: fetchModels,
    deleteModel,
    version,
    versionError,
    fetchOllamaVersion
  }
}
