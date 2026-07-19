import { useCallback } from "react"
import {
  performAppReset,
  type ResetKey,
  scheduleDestructiveReset
} from "@/lib/app-reset"
import { logger } from "@/lib/logger"

export type { ResetKey }

export const useResetAppStorage = () => {
  const reset = useCallback(async (key: ResetKey) => {
    try {
      if (key === "all" || key === "CHAT_SESSIONS") {
        // Destructive resets run in the background after a full extension
        // restart: pages holding IndexedDB handles would block the database
        // delete and fail re-initialization. The background reopens this
        // options page when it is done.
        await scheduleDestructiveReset(key, window.location.href)
        return "Resetting..."
      }

      await performAppReset(key)
      return `${String(key)} has been reset.`
    } catch (err) {
      logger.error("Failed to reset app data", "useResetAppStorage", {
        error: err
      })
      return "Failed to reset app data. Check console for details."
    }
  }, [])

  return reset
}
