import { useEffect, useState } from "react"

import type { ProviderConfig } from "@/lib/providers/types"
import { extensionRpcClient } from "@/protocol/extension-client"
import { RpcMethod } from "@/protocol/rpc"

export interface ProviderHealthEntry {
  success: boolean
  /**
   * False when the provider publishes no model catalog. Its models come from
   * the ids the user declared, so "connected" is not something this check can
   * claim — the UI says "model IDs only" instead.
   */
  modelListSupported: boolean
  lastChecked: number
}

export type ProviderHealthMap = Record<string, ProviderHealthEntry>

/*
 * A minute, not ten seconds.
 *
 * This runs against every enabled provider for as long as the settings screen
 * is open, and half of them are somebody's metered hosted endpoint. Ten seconds
 * bought a freshness nobody asked for at six requests a minute per provider,
 * forever. Config edits re-run the check immediately anyway — the effect
 * depends on `providers` — and the Test button covers deliberate checks, so the
 * heartbeat only has to catch a provider that dies while you watch.
 */
const HEALTH_CHECK_INTERVAL_MS = 60_000

/**
 * Poll every enabled provider through the provider connection RPC. A provider
 * is "healthy" when the call succeeds and it has at least one usable model —
 * discovered or declared. Disabled providers are skipped; their health entries
 * stay stale until they're re-enabled.
 *
 * The background pauses while the page is hidden and checks once on return, so
 * a settings tab left open in a window nobody is looking at costs nothing.
 */
export const useProviderHealth = (
  providers: ProviderConfig[]
): ProviderHealthMap => {
  const [health, setHealth] = useState<ProviderHealthMap>({})

  useEffect(() => {
    let cancelled = false

    const checkOne = async (provider: ProviderConfig) => {
      try {
        const result = await extensionRpcClient.call(
          RpcMethod.ProvidersTestConnection,
          { target: "stored", providerId: String(provider.id) }
        )
        if (cancelled) return
        setHealth((prev) => ({
          ...prev,
          [provider.id]: {
            success: result.modelCount > 0,
            modelListSupported: result.modelListSupported,
            lastChecked: Date.now()
          }
        }))
      } catch {
        if (cancelled) return
        setHealth((prev) => ({
          ...prev,
          [provider.id]: {
            success: false,
            modelListSupported: true,
            lastChecked: Date.now()
          }
        }))
      }
    }

    const checkAll = async () => {
      if (typeof document !== "undefined" && document.hidden) return
      for (const provider of providers) {
        if (!provider.enabled) continue
        await checkOne(provider)
      }
    }

    checkAll()
    const interval = setInterval(checkAll, HEALTH_CHECK_INTERVAL_MS)
    const onVisibilityChange = () => {
      if (!document.hidden) checkAll()
    }
    document.addEventListener("visibilitychange", onVisibilityChange)

    return () => {
      cancelled = true
      clearInterval(interval)
      document.removeEventListener("visibilitychange", onVisibilityChange)
    }
  }, [providers])

  return health
}
