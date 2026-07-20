import { useEffect } from "react"

import { chatSessionStore } from "@/features/sessions/stores/chat-session-store"
import { logger } from "@/lib/logger"
import { finalizeInterruptedMessages } from "@/lib/repositories/chat-history"

/**
 * How long an unfinished assistant row may go untouched before the sweep
 * treats it as orphaned. Must comfortably exceed the ~1s streaming write
 * cadence so a live turn (in any window) is never finalized. Also the delay
 * before the second sweep, which catches a turn that was mid-stream at mount
 * and then died.
 */
const STALE_MS = 20_000

/**
 * Finalize assistant turns cut off mid-stream by a worker/sidepanel death
 * (persisted as `done=0`), marking them done + interrupted so the UI offers a
 * retry.
 *
 * Ownership is enforced entirely by the finalize query's staleness filter — a
 * row is only finalized if it has not been written within `STALE_MS`, and
 * streaming writes bump every row's `updatedAt` ~every second. So a turn that
 * is actively streaming in ANOTHER window is never touched (its row is fresh),
 * and there is no separate liveness check to race against the finalize.
 *
 * Runs at mount and once more after `STALE_MS`: the second pass recovers a
 * turn that was still streaming at mount (so too fresh to finalize then) but
 * has since died. A turn that is genuinely still live stays fresh and is left
 * alone by both passes.
 */
export const useInterruptedTurnRecovery = () => {
  useEffect(() => {
    let cancelled = false

    const sweep = async () => {
      try {
        const fixed = await finalizeInterruptedMessages(STALE_MS)
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
    }

    void sweep()
    const retry = window.setTimeout(() => void sweep(), STALE_MS)

    return () => {
      cancelled = true
      window.clearTimeout(retry)
    }
  }, [])
}
