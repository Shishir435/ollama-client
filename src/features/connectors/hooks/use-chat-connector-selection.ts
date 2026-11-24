import type { PublicConnector } from "@ollama-client/contracts/connector-rpc"
import { useCallback, useEffect, useMemo, useState } from "react"
import { useChatSessions } from "@/features/sessions/stores/chat-session-store"
import { logger } from "@/lib/logger"
import { loadConnectors } from "./connector-commands"

/** A connector is worth offering a chat only if it has a tool to give. */
export const isOfferableConnector = (connector: PublicConnector): boolean =>
  connector.enabled && connector.tools.some((tool) => tool.enabled)

/**
 * The connectors a chat can switch between, and which of them are on.
 *
 * The choice is an exclusion list on the stored session: a chat that never
 * opened the picker, and a connector added later, are both "on". Ids of
 * connectors that no longer exist are ignored here and left for the background
 * filter, which only ever matches ids that do. Nothing is offered while the
 * list is loading or when no connector is enabled, so the picker can hide
 * itself on an empty answer.
 */
export const useChatConnectorSelection = () => {
  const {
    sessions,
    currentSessionId,
    createSession,
    setSessionDisabledConnectors
  } = useChatSessions(false)
  const [connectors, setConnectors] = useState<PublicConnector[]>([])

  useEffect(() => {
    let cancelled = false
    loadConnectors()
      .then((list) => {
        if (!cancelled) setConnectors(list.filter(isOfferableConnector))
      })
      .catch((error: unknown) => {
        logger.warn("Could not list connectors for the picker", "Connectors", {
          name: error instanceof Error ? error.name : typeof error
        })
      })
    return () => {
      cancelled = true
    }
  }, [])

  const disabled = useMemo(
    () =>
      new Set(
        sessions.find((session) => session.id === currentSessionId)
          ?.disabledConnectorIds ?? []
      ),
    [sessions, currentSessionId]
  )

  const toggle = useCallback(
    async (connectorId: string) => {
      /** A first chat has no row yet; choosing here creates it, as New Chat does. */
      const sessionId = currentSessionId ?? (await createSession())
      const next = new Set(disabled)
      if (next.has(connectorId)) next.delete(connectorId)
      else next.add(connectorId)
      await setSessionDisabledConnectors(sessionId, [...next])
    },
    [createSession, currentSessionId, disabled, setSessionDisabledConnectors]
  )

  return {
    connectors,
    isEnabledForChat: (connectorId: string) => !disabled.has(connectorId),
    toggle
  }
}
