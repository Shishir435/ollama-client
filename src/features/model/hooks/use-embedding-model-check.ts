import { RpcMethod } from "@ollama-client/contracts/rpc"
import { useEffect, useRef, useState } from "react"
import {
  DEFAULT_EMBEDDING_MODEL,
  DEFAULT_PROVIDER_ID,
  normalizeEmbeddingModelName
} from "@/lib/constants"
import {
  isLikelyEmbeddingModelName,
  recommendedEmbeddingBaseSet
} from "@/lib/embeddings/model-name-filter"
import { logger } from "@/lib/logger"
import { extensionRpcClient } from "@/protocol/extension-client"
import type { ProviderModel } from "@/types"

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

/**
 * Two responsibilities:
 *
 *   1. Verify the selected embedding model is actually installed on
 *      its provider. We ask the background worker every 5s (and
 *      immediately on selection change) via the
 *      `embeddings.checkModel` RPC round-trip.
 *   2. If the check fails and the user hasn't already been moved
 *      automatically, pick the best available alternative (prefer
 *      Ollama-hosted, then anything in our recommended set, then
 *      anything matching the "embed/embedding" name heuristic) and
 *      switch the selection there. The auto-switch fires once per
 *      selectedModel cycle so a user who manually re-selects the
 *      missing model is respected.
 *
 * Also normalizes `selectedModel` on mount — if Dexie-era legacy
 * names still leak through, they get rewritten on first read.
 */
export const useEmbeddingModelCheck = ({
  selectedModel,
  setSelectedModel,
  applyModelChange,
  embeddingModels,
  resolveProviderForModel
}: UseEmbeddingModelCheckOptions): boolean => {
  const [modelExists, setModelExists] = useState(false)
  const autoSwitchedRef = useRef(false)
  const lastCheckedModelRef = useRef<string | null>(null)

  useEffect(() => {
    const normalized = normalizeEmbeddingModelName(selectedModel)
    if (normalized !== selectedModel) {
      setSelectedModel(normalized)
      return
    }

    if (selectedModel !== lastCheckedModelRef.current) {
      autoSwitchedRef.current = false
      lastCheckedModelRef.current = selectedModel
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

        // Auto-switch only once per selectedModel cycle.
        if (autoSwitchedRef.current) return false

        const providerModels = embeddingModels.filter(
          (m) => m.providerId === DEFAULT_PROVIDER_ID
        )
        const candidates =
          providerModels.length > 0 ? providerModels : embeddingModels

        const byRecommended = candidates.find((m) =>
          recommendedEmbeddingBaseSet.has(m.name.toLowerCase().split(":")[0])
        )
        const byEmbedName = candidates.find((m) => {
          const name = m.name.toLowerCase()
          return name.includes("embed") || name.includes("embedding")
        })

        const nextModel = byRecommended?.name || byEmbedName?.name
        if (nextModel && nextModel !== currentModel) {
          autoSwitchedRef.current = true
          applyModelChange(nextModel, resolveProviderForModel(nextModel))
        }
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
  }, [
    applyModelChange,
    embeddingModels,
    resolveProviderForModel,
    selectedModel,
    setSelectedModel
  ])

  return modelExists
}
