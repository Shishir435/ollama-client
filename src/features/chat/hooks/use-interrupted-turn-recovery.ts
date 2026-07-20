import { useEffect } from "react"

import { isStreamingActiveElsewhere } from "@/features/chat/lib/streaming-heartbeat"
import { chatSessionStore } from "@/features/sessions/stores/chat-session-store"
import { logger } from "@/lib/logger"
import { finalizeInterruptedMessages } from "@/lib/repositories/chat-history"

/**
 * On sidepanel startup, finalize assistant turns that were cut off mid-stream
 * by a worker/sidepanel death (persisted as `done=0`). Marks them done and
 * flags them interrupted so the UI offers a retry.
 *
 * Runs once at mount. To avoid clobbering a turn that is actively streaming in
 * ANOTHER open panel, it defers when a live streaming heartbeat is present —
 * the DB-wide `done=0` set cannot otherwise distinguish a live turn from an
 * orphan. A clean reload clears the heartbeat, so single-window recovery still
 * runs immediately. If any orphans were fixed and a session is open, its
 * messages reload so the repaired state shows at once.
 */
export const useInterruptedTurnRecovery = () => {
  useEffect(() => {
    let cancelled = false

    void (async () => {
      try {
        if (await isStreamingActiveElsewhere()) return
        const fixed = await finalizeInterruptedMessages()
        if (cancelled || fixed === 0) return

        const { currentSessionId, loadSessionMessages } =
          chatSessionStore.getState()
        if (currentSessionId) await loadSessionMessages(currentSessionId)
      } catch (error) {
        logger.error(
          "Failed to finalize interrupted turns",
          "interruptedTurnRecovery",
          { error }
        )
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])
}
