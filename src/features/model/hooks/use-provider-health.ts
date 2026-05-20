import { useEffect, useState } from "react"

import { ProviderFactory } from "@/lib/providers/factory"
import type { ProviderConfig } from "@/lib/providers/types"

export interface ProviderHealthEntry {
  success: boolean
  lastChecked: number
}

export type ProviderHealthMap = Record<string, ProviderHealthEntry>

const HEALTH_CHECK_INTERVAL_MS = 10_000

/**
 * Poll every enabled provider every 10s, calling `getModels()` on a
 * fresh provider instance. A provider is "healthy" when the call
 * succeeds and returns at least one model. Disabled providers are
 * skipped — their health entries stay stale until they're re-enabled.
 *
 * Extracted from ProviderSettings so the polling concern lives in one
 * place and the settings screen renders are easier to read.
 */
export const useProviderHealth = (
  providers: ProviderConfig[]
): ProviderHealthMap => {
  const [health, setHealth] = useState<ProviderHealthMap>({})

  useEffect(() => {
    let cancelled = false

    const checkOne = async (provider: ProviderConfig) => {
      try {
        const instance = await ProviderFactory.getProviderWithConfig(provider)
        const models = await instance.getModels()
        if (cancelled) return
        setHealth((prev) => ({
          ...prev,
          [provider.id]: {
            success: models.length > 0,
            lastChecked: Date.now()
          }
        }))
      } catch {
        if (cancelled) return
        setHealth((prev) => ({
          ...prev,
          [provider.id]: { success: false, lastChecked: Date.now() }
        }))
      }
    }

    const checkAll = async () => {
      for (const provider of providers) {
        if (!provider.enabled) continue
        await checkOne(provider)
      }
    }

    checkAll()
    const interval = setInterval(checkAll, HEALTH_CHECK_INTERVAL_MS)

    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [providers])

  return health
}
