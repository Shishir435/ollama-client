import { useCallback, useEffect, useRef } from "react"
import { MESSAGE_KEYS, STORAGE_KEYS } from "@/lib/constants"
import { getPlasmoStorageForKey } from "@/lib/plasmo-global-storage"

const pendingOmniboxStorage = getPlasmoStorageForKey(
  STORAGE_KEYS.BROWSER.PENDING_OMNIBOX_QUERY
)

// Drop duplicate deliveries of the same query within this window. The omnibox
// fans a single query out across storage + runtime message, so it can arrive
// more than once.
const DEDUPE_WINDOW_MS = 2000

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
 * when the side panel opens before the selected model has hydrated.
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
    async (rawQuery: string) => {
      const query = rawQuery.trim()
      if (!query) return

      // Not ready yet: leave the query in storage so the readiness effect picks
      // it up once the model hydrates. Persist it explicitly because the
      // runtime-message path delivers the query without writing storage itself.
      if (!isModelReadyRef.current) {
        await pendingOmniboxStorage.set(
          STORAGE_KEYS.BROWSER.PENDING_OMNIBOX_QUERY,
          query
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
      const pendingQuery = await pendingOmniboxStorage.get<string>(
        STORAGE_KEYS.BROWSER.PENDING_OMNIBOX_QUERY
      )
      if (pendingQuery) await consumeOmniboxQuery(pendingQuery)
    }

    void checkPendingOmniboxQuery()

    const pendingOmniboxWatch = {
      [STORAGE_KEYS.BROWSER.PENDING_OMNIBOX_QUERY]: (change: {
        newValue?: string
      }) => {
        if (change.newValue) void consumeOmniboxQuery(change.newValue)
      }
    }

    pendingOmniboxStorage.watch(pendingOmniboxWatch)

    const handleMessage = (message: unknown) => {
      const msg = message as { type?: string; payload?: unknown }
      if (
        msg.type === MESSAGE_KEYS.BROWSER.OMNIBOX_QUERY &&
        typeof msg.payload === "string"
      ) {
        void consumeOmniboxQuery(msg.payload)
      }
    }

    chrome.runtime.onMessage.addListener(handleMessage)
    return () => {
      pendingOmniboxStorage.unwatch(pendingOmniboxWatch)
      chrome.runtime.onMessage.removeListener(handleMessage)
    }
  }, [consumeOmniboxQuery, isModelReady])
}
