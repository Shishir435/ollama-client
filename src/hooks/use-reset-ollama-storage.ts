import { useCallback } from "react"

import { db } from "@/lib/db"
import { getAllResetKeys } from "@/lib/get-all-reset-keys"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"

export type ResetKey = keyof ReturnType<typeof getAllResetKeys> | "all"

export const useResetOllamaStorage = () => {
  const reset = useCallback(async (key: ResetKey) => {
    try {
      const allKeys = getAllResetKeys()

      if (key === "all" || key === "CHAT_SESSIONS") {
        await db.delete()
      }

      if (key === "all") {
        await plasmoGlobalStorage.clear()
        sessionStorage.clear()
      } else if (key !== "CHAT_SESSIONS") {
        const keysToRemove = allKeys[key] || []
        if (keysToRemove.length > 0) {
          await Promise.all(
            keysToRemove.map((key) => plasmoGlobalStorage.remove(key))
          )
        }
      }

      return key === "all"
        ? "All Ollama Client data has been reset. Please reload the extension."
        : `${key} has been reset.`
    } catch (err) {
      console.error("Failed to reset Ollama Client:", err)
      return "Failed to reset Ollama Client. Check console for details."
    }
  }, [])

  return reset
}
