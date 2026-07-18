import { useEffect, useState } from "react"

import type { ProviderConfig } from "@/lib/providers/types"
import { extensionRpcClient } from "@/protocol/extension-client"
import { RpcMethod } from "@/protocol/rpc"

export interface ProviderHealthEntry {
  success: boolean
  lastChecked: number
}

export type ProviderHealthMap = Record<string, ProviderHealthEntry>

const HEALTH_CHECK_INTERVAL_MS = 10_000

/**
 * Poll every enabled provider every 10s through the provider connection RPC.
 * A provider is "healthy" when the call
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
        const result = await extensionRpcClient.call(
          RpcMethod.ProvidersTestConnection,
          { target: "stored", providerId: String(provider.id) }
        )
        if (cancelled) return
        setHealth((prev) => ({
          ...prev,
          [provider.id]: {
            success: result.modelCount > 0,
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
