import type {
  ConnectorDraft,
  ConnectorToolRisk,
  PublicConnector
} from "@ollama-client/contracts/connector-rpc"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { useToast } from "@/hooks/use-toast"
import { isAppError } from "@/lib/error-utils"
import { logger } from "@/lib/logger"
import {
  loadConnectors,
  refreshConnector,
  removeConnector,
  saveConnector,
  setConnectorTool,
  syncBridge
} from "./connector-commands"

/**
 * Connector list state for the settings card. Each action replaces the one
 * connector the background answered with, so a slow refresh of one server
 * never overwrites a toggle made on another.
 */
export const useConnectors = () => {
  const { t } = useTranslation()
  const { toast } = useToast()
  const [connectors, setConnectors] = useState<PublicConnector[]>([])
  const [loading, setLoading] = useState(true)
  /** Counted, so a save that runs a discovery stays busy until both end. */
  const [busyCounts, setBusyCounts] = useState<ReadonlyMap<string, number>>(
    new Map()
  )
  const busy = useMemo<ReadonlySet<string>>(
    () => new Set(busyCounts.keys()),
    [busyCounts]
  )

  /** Removed here, so a list read started earlier must not bring them back. */
  const removedRef = useRef(new Set<string>())
  const replace = useCallback((connector: PublicConnector) => {
    if (removedRef.current.has(connector.id)) return
    setConnectors((current) => {
      const index = current.findIndex((item) => item.id === connector.id)
      if (index === -1) return [...current, connector]
      const next = [...current]
      next[index] = connector
      return next
    })
  }, [])

  const fail = useCallback(
    (error: unknown, fallbackKey: string) => {
      logger.warn("Connector action failed", "Connectors", {
        messageKey: isAppError(error) ? error.messageKey : undefined
      })
      const key =
        isAppError(error) && error.messageKey ? error.messageKey : fallbackKey
      toast({ variant: "destructive", title: t(key) })
    },
    [t, toast]
  )

  const track = useCallback(
    async <T>(id: string, run: () => Promise<T>): Promise<T | undefined> => {
      const step = (delta: number) =>
        setBusyCounts((current) => {
          const next = new Map(current)
          const count = (next.get(id) ?? 0) + delta
          if (count > 0) next.set(id, count)
          else next.delete(id)
          return next
        })
      step(1)
      try {
        return await run()
      } finally {
        step(-1)
      }
    },
    []
  )

  useEffect(() => {
    let active = true
    loadConnectors()
      .then((list) => {
        /**
         * An action may have answered while the list was loading; its result
         * is newer than this snapshot, so it wins.
         */
        if (!active) return
        setConnectors((current) => {
          const newer = new Map(current.map((item) => [item.id, item]))
          const merged = list
            .filter((item) => !removedRef.current.has(item.id))
            .map((item) => newer.get(item.id) ?? item)
          const added = current.filter(
            (item) => !list.some((listed) => listed.id === item.id)
          )
          return [...merged, ...added]
        })
      })
      .catch((error) => fail(error, "settings.connectors.errors.load"))
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [fail])

  const refresh = useCallback(
    (id: string, quiet = false) =>
      track(id, async () => {
        try {
          const connector = await refreshConnector(id)
          replace(connector)
          if (!quiet)
            toast({
              title: t("settings.connectors.refreshed", {
                count: connector.tools.length
              })
            })
          return connector
        } catch (error) {
          fail(error, "settings.connectors.status.server_error")
          /** Pick up only this connector's recorded status, nothing older. */
          const list = await loadConnectors().catch(() => undefined)
          const current = list?.find((item) => item.id === id)
          if (current && !removedRef.current.has(id)) replace(current)
          return undefined
        }
      }),
    [fail, replace, t, toast, track]
  )

  const save = useCallback(
    (draft: ConnectorDraft): Promise<PublicConnector | undefined> =>
      track(draft.id ?? "new", async () => {
        let saved: PublicConnector
        try {
          saved = await saveConnector(draft)
        } catch (error) {
          fail(error, "settings.connectors.errors.save")
          return undefined
        }
        replace(saved)
        /** A new or re-pointed connector has no tools until it is discovered. */
        if (saved.enabled && saved.discoveredAt === undefined) {
          return (await refresh(saved.id)) ?? saved
        }
        return saved
      }),
    [fail, refresh, replace, track]
  )

  const remove = useCallback(
    (id: string) =>
      track(id, async () => {
        try {
          await removeConnector(id)
          removedRef.current.add(id)
          setConnectors((current) => current.filter((item) => item.id !== id))
        } catch (error) {
          fail(error, "settings.connectors.errors.save")
        }
      }),
    [fail, track]
  )

  const setTool = useCallback(
    (
      id: string,
      toolName: string,
      change: { enabled?: boolean; riskOverride?: ConnectorToolRisk | null }
    ) =>
      track(id, async () => {
        try {
          replace(await setConnectorTool(id, toolName, change))
        } catch (error) {
          fail(error, "settings.connectors.errors.save")
        }
      }),
    [fail, replace, track]
  )

  /**
   * Connect a bridge, then discover each server it added. Discovery runs one
   * server at a time so a bridge starting several children isn't flooded.
   */
  const connectBridge = useCallback(
    (baseUrl: string, token?: string) =>
      track("bridge", async (): Promise<boolean> => {
        let result: Awaited<ReturnType<typeof syncBridge>>
        try {
          result = await syncBridge(baseUrl, token)
        } catch (error) {
          fail(error, "settings.connectors.status.unreachable")
          return false
        }
        for (const connector of result.connectors) replace(connector)
        toast({
          title: t("settings.connectors.bridge.synced", {
            count: result.connectors.length
          }),
          ...(result.skipped > 0
            ? {
                description: t("settings.connectors.bridge.skipped", {
                  count: result.skipped
                })
              }
            : {})
        })
        /**
         * Every server is discovered again: the user reconnects after editing
         * mcp.json, so a server seen before may now offer different tools.
         */
        for (const connector of result.connectors) {
          if (connector.enabled) await refresh(connector.id, true)
        }
        return true
      }),
    [fail, refresh, replace, t, toast, track]
  )

  return {
    connectors,
    loading,
    busy,
    save,
    remove,
    refresh,
    setTool,
    connectBridge
  }
}
