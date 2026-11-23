import type {
  ConnectorDraft,
  ConnectorToolRisk,
  PublicConnector
} from "@ollama-client/contracts/connector-rpc"
import { useCallback, useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { useToast } from "@/hooks/use-toast"
import { isAppError } from "@/lib/error-utils"
import { logger } from "@/lib/logger"
import {
  loadConnectors,
  refreshConnector,
  removeConnector,
  saveConnector,
  setConnectorTool
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
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set())

  const replace = useCallback((connector: PublicConnector) => {
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
      setBusy((current) => new Set(current).add(id))
      try {
        return await run()
      } finally {
        setBusy((current) => {
          const next = new Set(current)
          next.delete(id)
          return next
        })
      }
    },
    []
  )

  useEffect(() => {
    let active = true
    loadConnectors()
      .then((list) => {
        if (active) setConnectors(list)
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
    (id: string) =>
      track(id, async () => {
        try {
          const connector = await refreshConnector(id)
          replace(connector)
          toast({
            title: t("settings.connectors.refreshed", {
              count: connector.tools.length
            })
          })
          return connector
        } catch (error) {
          fail(error, "settings.connectors.status.server_error")
          const list = await loadConnectors().catch(() => undefined)
          if (list) setConnectors(list)
          return undefined
        }
      }),
    [fail, replace, t, toast, track]
  )

  const save = useCallback(
    async (draft: ConnectorDraft): Promise<PublicConnector | undefined> => {
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
    },
    [fail, refresh, replace]
  )

  const remove = useCallback(
    (id: string) =>
      track(id, async () => {
        try {
          await removeConnector(id)
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

  return { connectors, loading, busy, save, remove, refresh, setTool }
}
