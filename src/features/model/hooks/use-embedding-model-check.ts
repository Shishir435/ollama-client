import { RpcMethod } from "@ollama-client/contracts/rpc"
import { useEffect, useState } from "react"
import {
  DEFAULT_EMBEDDING_MODEL,
  normalizeEmbeddingModelName
} from "@/lib/constants"
import { isLikelyEmbeddingModelName } from "@/lib/embeddings/model-name-filter"
import { logger } from "@/lib/logger"
import { extensionRpcClient } from "@/protocol/extension-client"
import type { ProviderModel } from "@/types"
import { useNativeEmbeddings } from "./use-native-embeddings"

/**
 * Only the "model is missing" state needs re-checking on a timer — the user is
 * expected to be pulling it right now. Once the model is present nothing polls,
 * because every tick wakes the MV3 service worker and issues a provider
 * request; a settings tab left open used to do that forever.
 */
const POLL_INTERVAL_MS = 5_000

export interface UseEmbeddingModelCheckOptions {
  /** Currently-selected embedding model name. */
  selectedModel: string
  /** Persists the (possibly-new) selected model name. */
  setSelectedModel: (next: string) => void
  /** Persists the new model+provider as the shared embedding choice. */
  applyModelChange: (model: string, providerId: string) => void
  /** All provider-discovered embedding models for the auto-switch search. */
  embeddingModels: ProviderModel[]
  /** Resolve a model name to its owning provider. */
  resolveProviderForModel: (modelName: string) => string
}

/** Check availability without silently changing the chosen provider or model. */
export const useEmbeddingModelCheck = ({
  selectedModel,
  setSelectedModel,
  resolveProviderForModel
}: UseEmbeddingModelCheckOptions): boolean => {
  const [modelExists, setModelExists] = useState(false)
  const { state } = useNativeEmbeddings()

  const nativeMode = state?.mode
  useEffect(() => {
    if (!nativeMode || nativeMode === "bundled") {
      setModelExists(nativeMode === "bundled")
      return
    }
    const normalized = normalizeEmbeddingModelName(selectedModel)
    if (normalized !== selectedModel) {
      setSelectedModel(normalized)
      return
    }

    const checkModel = async (): Promise<boolean> => {
      try {
        const currentModel = selectedModel || DEFAULT_EMBEDDING_MODEL
        const looksLikeEmbedding = isLikelyEmbeddingModelName(currentModel)
        const currentProviderId = resolveProviderForModel(currentModel)
        const response = await extensionRpcClient.call(
          RpcMethod.EmbeddingsCheckModel,
          {
            model: currentModel,
            ...(currentProviderId && { providerId: currentProviderId })
          }
        )

        if (response.debug) {
          logger.debug(
            `Check debug for ${currentModel}`,
            "useEmbeddingModelCheck",
            response.debug
          )
        }

        const exists = looksLikeEmbedding && response.exists

        setModelExists(exists)
        if (exists) return true

        return false
      } catch (error) {
        logger.error(
          "Error checking embedding model",
          "useEmbeddingModelCheck",
          { error }
        )
        setModelExists(false)
        return false
      }
    }

    let cancelled = false
    let running = false
    let interval: ReturnType<typeof setInterval> | null = null

    const stopPolling = () => {
      if (!interval) return
      clearInterval(interval)
      interval = null
    }

    // A visibility change and an interval tick can land together; without the
    // in-flight guard the same RPC runs twice, concurrently.
    const runCheck = async () => {
      if (cancelled || running) return
      if (typeof document !== "undefined" && document.hidden) return
      running = true
      try {
        const exists = await checkModel()
        // Nothing left to watch for once the model is present. A later change
        // to `selectedModel` re-runs this effect and re-arms the timer.
        if (exists) stopPolling()
      } finally {
        running = false
      }
    }

    runCheck()
    interval = setInterval(runCheck, POLL_INTERVAL_MS)

    const onVisibilityChange = () => {
      if (!document.hidden) runCheck()
    }
    document.addEventListener("visibilitychange", onVisibilityChange)

    return () => {
      cancelled = true
      stopPolling()
      document.removeEventListener("visibilitychange", onVisibilityChange)
    }
  }, [nativeMode, resolveProviderForModel, selectedModel, setSelectedModel])

  return modelExists
}
