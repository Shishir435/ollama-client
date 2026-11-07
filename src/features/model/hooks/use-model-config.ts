import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { DEFAULT_MODEL_CONFIG } from "@/lib/constants"
import { logger } from "@/lib/logger"
import { resolveModelConfig } from "@/lib/model-config-utils"
import {
  getStoredModelConfigFor,
  updateModelConfig
} from "@/lib/repositories/model-configs"
import { subscribeModelPreferences } from "@/lib/repositories/model-preferences"
import type { ModelConfig } from "@/types"

export type ProviderModelConfig = typeof DEFAULT_MODEL_CONFIG

/**
 * One model's parameters, read from and written to its own SQLite row. A
 * change shows at once and is written in order behind any earlier one.
 *
 * Same race rules as `useSetting`: a read is applied only when no write is in
 * flight and none started since the read began, and the row is read again
 * once the last write settles — which both picks up a change another page
 * made meanwhile and rolls back a failed write without undoing a newer one.
 */
export const useModelConfig = (modelName: string, providerId?: string) => {
  const scope = `${providerId ?? ""}::${modelName}`
  const [state, setState] = useState<{
    scope: string
    stored: Partial<ModelConfig> | undefined
  }>({ scope, stored: undefined })
  const pendingRef = useRef(0)
  const generationRef = useRef(0)
  const queueRef = useRef<Promise<void>>(Promise.resolve())
  const loadRef = useRef<() => void>(() => {})

  useEffect(() => {
    let active = true
    const load = () => {
      const generation = generationRef.current
      void getStoredModelConfigFor(modelName, providerId)
        .then((stored) => {
          if (
            active &&
            pendingRef.current === 0 &&
            generationRef.current === generation
          ) {
            setState({ scope, stored })
          }
        })
        .catch((error) => {
          logger.error("Model config read failed", "useModelConfig", { error })
        })
    }
    loadRef.current = load
    load()
    const unsubscribe = subscribeModelPreferences((kind) => {
      if (kind === "config") load()
    })
    return () => {
      active = false
      loadRef.current = () => {}
      unsubscribe()
    }
  }, [modelName, providerId, scope])

  const stored = state.scope === scope ? state.stored : undefined
  const config = useMemo(() => resolveModelConfig(stored), [stored])

  const update = useCallback(
    (patch: Partial<ModelConfig>) => {
      setState((current) => ({
        scope,
        stored: {
          ...(current.scope === scope ? current.stored : undefined),
          ...patch
        }
      }))
      pendingRef.current += 1
      generationRef.current += 1
      queueRef.current = queueRef.current
        .then(() => updateModelConfig(modelName, providerId, patch))
        .catch((error) => {
          logger.error("Model config write failed", "useModelConfig", {
            error
          })
        })
        .finally(() => {
          pendingRef.current -= 1
          if (pendingRef.current === 0) loadRef.current()
        })
    },
    [modelName, providerId, scope]
  )

  return [config, update] as const
}
