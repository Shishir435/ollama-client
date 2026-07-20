import { useEffect } from "react"

import { chatSessionStore } from "@/features/sessions/stores/chat-session-store"
import { logger } from "@/lib/logger"
import { finalizeInterruptedMessages } from "@/lib/repositories/chat-history"

/**
 * On sidepanel startup, finalize assistant turns that were cut off mid-stream
 * by a worker/sidepanel death (persisted as `done=0`). Runs once: at mount
 * nothing is streaming yet, so the only in-flight rows are genuine orphans.
 * If any were fixed and a session is already open, reload its messages so the
 * repaired (interrupted) state shows without waiting for the next navigation.
 */
export const useInterruptedTurnRecovery = () => {
  useEffect(() => {
    let cancelled = false

    void (async () => {
      try {
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
