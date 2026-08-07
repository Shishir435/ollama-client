import { useEffect, useMemo, useRef, useState } from "react"

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
 * forever. A saved config change still re-checks straight away, and the Test
 * button covers deliberate checks, so the heartbeat only has to catch a
 * provider that dies while you watch.
 */
const HEALTH_CHECK_INTERVAL_MS = 60_000

/*
 * How long a config change is left to settle before it is checked.
 *
 * Every keystroke in the base-URL field produces a new `providers` array, and
 * this effect used to key on that array's identity — so typing one URL fired
 * one connection test per character, each against whatever partial value was
 * in the box. On a hosted provider that is a real API call per keypress.
 */
const CONFIG_SETTLE_MS = 700

/**
 * Field separator inside a signature row. Deliberately a character no provider
 * id, URL, wire, or profile can contain, so splitting a row back apart cannot
 * be confused by a value that happens to hold the separator.
 */
const FIELD = "\u001f"

/**
 * What actually decides the answer: which providers exist, which are on, and
 * where they point. Everything else about a provider — its name, its declared
 * model ids, an API key being retyped — cannot change whether it is reachable,
 * so it must not cost a request.
 */
const healthSignature = (providers: ProviderConfig[]): string =>
  providers
    .filter((provider) => provider.enabled)
    .map((provider) =>
      [
        String(provider.id),
        provider.baseUrl ?? "",
        String(provider.type),
        provider.serviceProfile ?? ""
      ].join(FIELD)
    )
    .join("\n")

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
  const signature = healthSignature(providers)
  // A stable list for as long as the signature is: the string is rebuilt on
  // every render but is equal across renders that changed nothing this hook
  // cares about, so the effect below does not restart on each keystroke.
  const targets = useMemo(
    () =>
      signature
        ? signature.split("\n").map((row) => row.split(FIELD)[0])
        : ([] as string[]),
    [signature]
  )
  // The first run is the settings screen opening and should not sit behind the
  // settle delay; later runs are edits, and those should.
  const hasRun = useRef(false)

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

    const checkAll = async () => {
      if (typeof document !== "undefined" && document.hidden) return
      for (const providerId of targets) {
        await checkOne(providerId)
      }
    }

    const settle = setTimeout(checkAll, hasRun.current ? CONFIG_SETTLE_MS : 0)
    hasRun.current = true
    const interval = setInterval(checkAll, HEALTH_CHECK_INTERVAL_MS)
    const onVisibilityChange = () => {
      if (!document.hidden) checkAll()
    }
    document.addEventListener("visibilitychange", onVisibilityChange)

    return () => {
      cancelled = true
      clearTimeout(settle)
      clearInterval(interval)
      document.removeEventListener("visibilitychange", onVisibilityChange)
    }
  }, [targets])

  return health
}
