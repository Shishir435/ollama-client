import { useCallback } from "react"
import { browser } from "wxt/browser"
import { feedbackService } from "@/lib/embeddings/feedback-service"
import { getAllResetKeys } from "@/lib/get-all-reset-keys"
import { logger } from "@/lib/logger"
import {
  plasmoDeviceStorage,
  plasmoGlobalStorage,
  removePlasmoStoredValue
} from "@/lib/plasmo-global-storage"
import {
  resetProviderStorageUnlocked,
  withProviderPersistenceLock
} from "@/lib/providers/provider-secret-store"
import { resetSQLiteDatabase } from "@/lib/sqlite/db"

export type ResetKey = keyof ReturnType<typeof getAllResetKeys> | "all"

export const useResetAppStorage = () => {
  const reset = useCallback(async (key: ResetKey) => {
    try {
      const allKeys = getAllResetKeys()

      if (key === "all" || key === "CHAT_SESSIONS") {
        await resetSQLiteDatabase()
      }

      if (key === "all" || key === "FEEDBACK") {
        await feedbackService.clearAllFeedback()
      }

      if (key === "all") {
        await withProviderPersistenceLock(async () => {
          await resetProviderStorageUnlocked(allKeys.PROVIDER || [])
          await plasmoGlobalStorage.clear()
          await plasmoDeviceStorage.clear()
        })
        sessionStorage.clear()
      } else if (key !== "CHAT_SESSIONS" && key !== "FEEDBACK") {
        const keysToRemove = allKeys[key] || []
        if (keysToRemove.length > 0) {
          const removeKeys = () =>
            Promise.all(keysToRemove.map((key) => removePlasmoStoredValue(key)))

          if (key === "PROVIDER") {
            await withProviderPersistenceLock(() =>
              resetProviderStorageUnlocked(keysToRemove)
            )
          } else {
            await removeKeys()
          }
        }
      }

      if (key === "all" || key === "CHAT_SESSIONS") {
        // Restart the whole extension so every context — including the
        // background worker, which has no APP.RELOAD listener — reinitializes
        // with the new import generation. Contexts left running with the old
        // generation have all chat saves silently skipped.
        setTimeout(() => {
          try {
            browser.runtime.reload()
          } catch {
            window.location.reload()
          }
        }, 100)
        return "Resetting..."
      }

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
