import { useCallback } from "react"
import {
  performAppReset,
  type ResetKey,
  scheduleDestructiveReset
} from "@/lib/app-reset"
import { logger } from "@/lib/logger"

export type { ResetKey }

export interface ResetOutcome {
  ok: boolean
  message: string
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
        return { ok: true, message: "Resetting..." }
      }

      await performAppReset(key)
      return { ok: true, message: `${String(key)} has been reset.` }
    } catch (err) {
      logger.error("Failed to reset app data", "useResetAppStorage", {
        error: err
      })
      return {
        ok: false,
        message: "Failed to reset app data. Check console for details."
      }
    }
  }, [])

  return reset
}
