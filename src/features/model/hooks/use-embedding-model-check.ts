import { useEffect, useRef, useState } from "react"
import {
  DEFAULT_EMBEDDING_MODEL,
  DEFAULT_PROVIDER_ID,
  MESSAGE_KEYS,
  normalizeEmbeddingModelName
} from "@/lib/constants"
import {
  isLikelyEmbeddingModelName,
  recommendedEmbeddingBaseSet
} from "@/lib/embeddings/model-name-filter"
import { logger } from "@/lib/logger"
import { sendRuntimeMessage } from "@/lib/runtime-messages"
import type { ProviderModel } from "@/types"

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
 *      `MESSAGE_KEYS.PROVIDER.CHECK_EMBEDDING_MODEL` round-trip.
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

    const checkModel = async () => {
      try {
        const currentModel = selectedModel || DEFAULT_EMBEDDING_MODEL
        const looksLikeEmbedding = isLikelyEmbeddingModelName(currentModel)
        const currentProviderId = resolveProviderForModel(currentModel)
        const response = await sendRuntimeMessage(
          MESSAGE_KEYS.PROVIDER.CHECK_EMBEDDING_MODEL,
          {
            payload: { model: currentModel, providerId: currentProviderId }
          }
        )

        if (response?.data?.debug) {
          logger.debug(
            `Check debug for ${currentModel}`,
            "useEmbeddingModelCheck",
            response.data.debug
          )
        }

        const exists =
          looksLikeEmbedding &&
          response?.success === true &&
          response.data?.exists === true

        setModelExists(exists)
        if (exists) return

        // Auto-switch only once per selectedModel cycle.
        if (autoSwitchedRef.current) return

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
      } catch (error) {
        logger.error(
          "Error checking embedding model",
          "useEmbeddingModelCheck",
          { error }
        )
        setModelExists(false)
      }
    }

    checkModel()
    const interval = setInterval(checkModel, POLL_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [
    applyModelChange,
    embeddingModels,
    resolveProviderForModel,
    selectedModel,
    setSelectedModel
  ])

  return modelExists
}
