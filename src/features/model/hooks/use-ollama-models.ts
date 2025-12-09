import { useCallback, useEffect, useState } from "react"

import { browser } from "@/lib/browser-api"
import { MESSAGE_KEYS } from "@/lib/constants"
import { logger } from "@/lib/logger"
import type { ChromeResponse, OllamaModel } from "@/types"

export const useOllamaModels = () => {
  const [models, setModels] = useState<OllamaModel[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState<boolean>(true)

  const [version, setVersion] = useState<string | null>(null)
  const [versionError, setVersionError] = useState<string | null>(null)

  const fetchModels = useCallback(async () => {
    setLoading(true)
    try {
      const response = (await browser.runtime.sendMessage({
        type: MESSAGE_KEYS.OLLAMA.GET_MODELS
      })) as ChromeResponse & { data?: { models?: OllamaModel[] } }
      if (response?.success) {
        setModels(response.data?.models ?? [])
        setError(null)
      } else {
        setError(
          "Failed to fetch models. Ensure Ollama is running or check the base URL."
        )
        setModels(null)
      }
    } catch (error) {
      logger.error("Failed to fetch models", "useOllamaModels", { error })
      setError(
        "Failed to fetch models. Ensure Ollama is running or check the base URL."
      )
      setModels(null)
    } finally {
      setLoading(false)
    }
  }, [])

  const deleteModel = async (modelName: string) => {
    try {
      const response = (await browser.runtime.sendMessage({
        type: MESSAGE_KEYS.OLLAMA.DELETE_MODEL,
        payload: modelName
      })) as ChromeResponse
      if (response?.success) {
        // Optimistically update local state
        setModels((prev) =>
          prev ? prev.filter((model) => model.name !== modelName) : null
        )
      } else {
        logger.error("Failed to delete model", "useOllamaModels", {
          modelName,
          error: response?.error?.message
        })
      }
    } catch (error) {
      logger.error("Failed to delete model", "useOllamaModels", {
        modelName,
        error
      })
    }
  }

  const fetchOllamaVersion = useCallback(async () => {
    try {
      const response = (await browser.runtime.sendMessage({
        type: MESSAGE_KEYS.OLLAMA.GET_OLLAMA_VERSION
      })) as ChromeResponse & { data?: { version?: string } }
      if (response?.success) {
        setVersion(response.data?.version ?? null)
        setVersionError(null)
      } else {
        setVersionError("Failed to fetch Ollama version.")
        setVersion(null)
      }
    } catch (error) {
      logger.error("Failed to fetch Ollama version", "useOllamaModels", {
        error
      })
      setVersionError("Failed to fetch Ollama version.")
      setVersion(null)
    }
  }, [])

  useEffect(() => {
    fetchModels()
    fetchOllamaVersion()
  }, [fetchModels, fetchOllamaVersion])

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
