import type { PublicConnector } from "@ollama-client/contracts/connector-rpc"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  chatSessionStore,
  useChatSessions
} from "@/features/sessions/stores/chat-session-store"
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
  const { sessions, currentSessionId } = useChatSessions(false)
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

  /**
   * One save at a time, each starting from the stored choice as the last one
   * left it, so quick clicks accumulate instead of overwriting each other.
   */
  const queue = useRef(Promise.resolve())
  const toggle = useCallback((connectorId: string) => {
    queue.current = queue.current
      .then(async () => {
        const store = chatSessionStore.getState()
        /** A first chat has no row yet; choosing here creates it, as New Chat does. */
        const sessionId =
          store.currentSessionId ?? (await store.createSession())
        const next = new Set(
          chatSessionStore
            .getState()
            .sessions.find((session) => session.id === sessionId)
            ?.disabledConnectorIds ?? []
        )
        if (!next.delete(connectorId)) next.add(connectorId)
        await store.setSessionDisabledConnectors(sessionId, [...next])
      })
      .catch((error: unknown) => {
        logger.warn("Could not save the chat's connectors", "Connectors", {
          name: error instanceof Error ? error.name : typeof error
        })
      })
    return queue.current
  }, [])

  return {
    connectors,
    isEnabledForChat: (connectorId: string) => !disabled.has(connectorId),
    toggle
  }
}
