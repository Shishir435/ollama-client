import { useEffect, useState } from "react"
import { logger } from "@/lib/logger"
import { subscribeModelPreferences } from "@/lib/repositories/model-preferences"
import { getToolModelOverride } from "@/lib/tools/tool-model-overrides"

/**
 * Whether the user opted this model into the prompt-based tool fallback, the
 * same per-model switch the background reads before offering tools to a model
 * without native tool calling. Re-read whenever a tool override is saved, so a
 * control blocked on it unblocks the moment the switch is turned on.
 */
export const useToolFallbackEnabled = (
  modelRef: { providerId: string; modelId: string } | null
): boolean => {
  const providerId = modelRef?.providerId
  const modelId = modelRef?.modelId
  const key = providerId && modelId ? `${providerId}::${modelId}` : null
  /**
   * Kept with the model it was read for, so switching models never shows the
   * previous model's answer while the new one loads.
   */
  const [read, setRead] = useState<{ key: string; enabled: boolean } | null>(
    null
  )

  useEffect(() => {
    if (!providerId || !modelId) return
    const readKey = `${providerId}::${modelId}`
    let active = true
    const load = () => {
      void getToolModelOverride(providerId, modelId)
        .then((override) => {
          if (active) {
            setRead({
              key: readKey,
              enabled: Boolean(override?.nonNativeToolFallback)
            })
          }
        })
        .catch((error) => {
          logger.warn("Tool override read failed", "useToolFallbackEnabled", {
            error
          })
        })
    }
    load()
    const unsubscribe = subscribeModelPreferences((kind) => {
      if (kind === "tools") load()
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [providerId, modelId])

  return read !== null && read.key === key && read.enabled
}
