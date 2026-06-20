import { useCallback, useEffect, useRef } from "react"
import { browser } from "@/lib/browser-api"
import { MESSAGE_KEYS, STORAGE_KEYS } from "@/lib/constants"
import { getPlasmoStorageForKey } from "@/lib/plasmo-global-storage"
import type { PendingOmniboxQuery } from "@/types/messaging"

const pendingOmniboxStorage = getPlasmoStorageForKey(
  STORAGE_KEYS.BROWSER.PENDING_OMNIBOX_QUERY
)

// Drop duplicate deliveries of the same query within this window. The omnibox
// fans a single query out across storage + runtime message, so it can arrive
// more than once.
const DEDUPE_WINDOW_MS = 2000

// Discard a persisted query older than this. A query stored while no model was
// ready (and never consumed — e.g. the panel was closed) must not auto-send on
// a much later side-panel open. Comfortably longer than model hydration.
const PENDING_QUERY_TTL_MS = 60_000

interface UseOmniboxQueryOptions {
  /** Sends the query as a chat turn. */
  sendMessage: (input: string) => void
  /** Whether a model has hydrated and is ready to receive a turn. */
  isModelReady: boolean
}

/**
 * Wires the omnibox quick-ask ("olc <query>") into the chat surface.
 *
 * The background writes the query to storage and also forwards it as a runtime
 * message. This hook consumes whichever arrives, de-dupes, and sends it once a
 * model is ready — holding the query in storage until then so it is not lost
 * when the side panel opens before the selected model has hydrated. Queries
 * older than PENDING_QUERY_TTL_MS are dropped rather than auto-sent.
 *
 * Kept out of the Chat component so chat UI and omnibox plumbing stay decoupled.
 */
export const useOmniboxQuery = ({
  sendMessage,
  isModelReady
}: UseOmniboxQueryOptions): void => {
  const lastOmniboxQueryRef = useRef<{ query: string; at: number } | null>(null)
  const isModelReadyRef = useRef(isModelReady)
  isModelReadyRef.current = isModelReady

  const consumeOmniboxQuery = useCallback(
    async (rawQuery: string, issuedAt: number) => {
      const query = rawQuery.trim()
      if (!query) return

      // Stale: the query was issued too long ago to safely auto-send.
      if (Date.now() - issuedAt > PENDING_QUERY_TTL_MS) {
        await pendingOmniboxStorage.remove(
          STORAGE_KEYS.BROWSER.PENDING_OMNIBOX_QUERY
        )
        return
      }

      // Not ready yet: leave the query in storage so the readiness effect picks
      // it up once the model hydrates. Persist it explicitly (the runtime-message
      // path delivers the query without writing storage itself) and preserve the
      // original issue time so the TTL is measured from when the user typed it.
      if (!isModelReadyRef.current) {
        const value: PendingOmniboxQuery = { query, at: issuedAt }
        await pendingOmniboxStorage.set(
          STORAGE_KEYS.BROWSER.PENDING_OMNIBOX_QUERY,
          value
        )
        return
      }

      const now = Date.now()
      const lastQuery = lastOmniboxQueryRef.current
      if (lastQuery?.query === query && now - lastQuery.at < DEDUPE_WINDOW_MS) {
        await pendingOmniboxStorage.remove(
          STORAGE_KEYS.BROWSER.PENDING_OMNIBOX_QUERY
        )
        return
      }

      lastOmniboxQueryRef.current = { query, at: now }
      await pendingOmniboxStorage.remove(
        STORAGE_KEYS.BROWSER.PENDING_OMNIBOX_QUERY
      )
      sendMessage(query)
    },
    [sendMessage]
  )

  useEffect(() => {
    // Re-check whenever the model becomes ready so a query that arrived before
    // hydration is sent as soon as a model is available.
    if (!isModelReady) return

    const checkPendingOmniboxQuery = async () => {
      const pending = await pendingOmniboxStorage.get<PendingOmniboxQuery>(
        STORAGE_KEYS.BROWSER.PENDING_OMNIBOX_QUERY
      )
      if (pending?.query) await consumeOmniboxQuery(pending.query, pending.at)
    }

    void checkPendingOmniboxQuery()

    const pendingOmniboxWatch = {
      [STORAGE_KEYS.BROWSER.PENDING_OMNIBOX_QUERY]: (change: {
        newValue?: PendingOmniboxQuery
      }) => {
        if (change.newValue?.query) {
          void consumeOmniboxQuery(change.newValue.query, change.newValue.at)
        }
      }
    }

    pendingOmniboxStorage.watch(pendingOmniboxWatch)

    const handleMessage = (message: unknown) => {
      const msg = message as { type?: string; payload?: unknown }
      if (
        msg.type === MESSAGE_KEYS.BROWSER.OMNIBOX_QUERY &&
        typeof msg.payload === "string"
      ) {
        // The background also forwards the address-bar `disposition`
        // (Enter vs Alt/Meta+Enter). It is intentionally ignored: the side
        // panel is the only chat surface, so every quick-ask opens there
        // regardless of how the user submitted the omnibox entry.
        // The runtime message is live, so its issue time is now.
        void consumeOmniboxQuery(msg.payload, Date.now())
      }
    }

    browser.runtime.onMessage.addListener(handleMessage)
    return () => {
      pendingOmniboxStorage.unwatch(pendingOmniboxWatch)
      browser.runtime.onMessage.removeListener(handleMessage)
    }
  }, [consumeOmniboxQuery, isModelReady])
}
