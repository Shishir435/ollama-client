import { useCallback } from "react"
import { db as dexieDb } from "@/lib/db"
import { feedbackService } from "@/lib/embeddings/feedback-service"
import { getAllResetKeys } from "@/lib/get-all-reset-keys"
import { logger } from "@/lib/logger"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"
import { resetSQLiteDatabase } from "@/lib/sqlite/db"

export type ResetKey = keyof ReturnType<typeof getAllResetKeys> | "all"

export const useResetAppStorage = () => {
  const reset = useCallback(async (key: ResetKey) => {
    try {
      const allKeys = getAllResetKeys()

      if (key === "all" || key === "CHAT_SESSIONS") {
        await dexieDb.delete()
        await resetSQLiteDatabase()
      }

      if (key === "all" || key === "FEEDBACK") {
        await feedbackService.clearAllFeedback()
      }

      if (key === "all") {
        await plasmoGlobalStorage.clear()
        sessionStorage.clear()
      } else if (key !== "CHAT_SESSIONS" && key !== "FEEDBACK") {
        const keysToRemove = allKeys[key] || []
        if (keysToRemove.length > 0) {
          await Promise.all(
            keysToRemove.map((key) => plasmoGlobalStorage.remove(key))
          )
        }
      }

      return key === "all"
        ? "All app data has been reset. Please reload the extension."
        : `${String(key)} has been reset.`
    } catch (err) {
      logger.error("Failed to reset app data", "useResetAppStorage", {
        error: err
      })
      return "Failed to reset app data. Check console for details."
    }
  }, [])

  return reset
}
