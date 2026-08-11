import { RpcMethod } from "@ollama-client/contracts/rpc"
import { useEffect, useMemo, useState } from "react"
import type { ProviderConfig } from "@/lib/providers/types"
import { extensionRpcClient } from "@/protocol/extension-client"

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
 * forever. A saved config change still re-checks straight away, and the Test
 * button covers deliberate checks, so the heartbeat only has to catch a
 * provider that dies while you watch.
 */
const HEALTH_CHECK_INTERVAL_MS = 60_000

/**
 * Which providers this check has anything to say about.
 *
 * Not where they point: the check tests *stored* config, so a base URL the
 * user is still typing describes an endpoint it will not contact. Keying on
 * the draft is what made typing one URL fire one connection test per
 * character — and a debounce only hid that, because the check still ran
 * against the old stored value and then never re-ran once the save landed.
 * `savedRevision` is the signal for "the stored endpoint changed"; this is the
 * signal for "the set of providers changed".
 */
const healthSignature = (
  providers: ProviderConfig[],
  savedRevision: number
): string =>
  [
    // The revision rides along as the first row so a save rebuilds the list:
    // the same providers now point somewhere else, and the answers already on
    // screen describe the endpoint they used to have.
    String(savedRevision),
    ...providers
      .filter((provider) => provider.enabled)
      .map((provider) => String(provider.id))
  ].join("\n")

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
  providers: ProviderConfig[],
  savedRevision = 0
): ProviderHealthMap => {
  const [health, setHealth] = useState<ProviderHealthMap>({})
  const signature = healthSignature(providers, savedRevision)
  // A stable list for as long as the signature is: the string is rebuilt on
  // every render but is equal across renders that changed nothing this hook
  // cares about, so the effect below does not restart on each keystroke.
  const targets = useMemo(() => signature.split("\n").slice(1), [signature])

  useEffect(() => {
    let cancelled = false

    const checkOne = async (providerId: string) => {
      try {
        const result = await extensionRpcClient.call(
          RpcMethod.ProvidersTestConnection,
          { target: "stored", providerId }
        )
        if (cancelled) return
        setHealth((prev) => ({
          ...prev,
          [providerId]: {
            success: result.modelCount > 0,
            modelListSupported: result.modelListSupported,
            lastChecked: Date.now()
          }
        }))
      } catch {
        if (cancelled) return
        setHealth((prev) => ({
          ...prev,
          [providerId]: {
            success: false,
            modelListSupported: true,
            lastChecked: Date.now()
          }
        }))
      }
    }

    // Returning to a visible page and the interval can land together; without
    // this the same sweep runs twice, concurrently, against every provider.
    let running = false
    const checkAll = async () => {
      if (running) return
      if (typeof document !== "undefined" && document.hidden) return
      running = true
      try {
        for (const providerId of targets) {
          await checkOne(providerId)
        }
      } finally {
        running = false
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
  }, [targets])

  return health
}
