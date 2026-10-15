import { useCallback } from "react"
import {
  performAppReset,
  type ResetKey,
  scheduleDestructiveReset
} from "@/lib/app-reset"
import { logger } from "@/lib/logger"

export type { ResetKey }

/** Whether the reset ran (or was scheduled). Callers own the user-facing copy. */
export interface ResetOutcome {
  ok: boolean
}

export const useResetAppStorage = () => {
  const reset = useCallback(async (key: ResetKey): Promise<ResetOutcome> => {
    try {
      if (key === "all" || key === "CHAT_SESSIONS") {
        // Destructive resets run in the background after a full extension
        // restart: pages holding IndexedDB handles would block the database
        // delete and fail re-initialization. The background reopens this
        // options page when it is done.
        await scheduleDestructiveReset(key, window.location.href)
        return { ok: true }
      }

      await performAppReset(key)
      return { ok: true }
    } catch (err) {
      logger.error("Failed to reset app data", "useResetAppStorage", {
        error: err
      })
      return { ok: false }
    }
  }, [])

  return reset
}
