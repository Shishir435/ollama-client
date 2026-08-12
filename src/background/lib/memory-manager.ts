import { storeChatMessage } from "@/lib/embeddings/vector-store"
import { logger } from "@/lib/logger"
import { readSetting } from "@/lib/storage/setting-access"
import { SETTINGS } from "@/lib/storage/settings"

export interface ChatMemoryPayload {
  userMessage: string
  aiResponse: string
  sessionId: string
  chatId?: string
}

/**
 * Memory Manager
 * Handles asynchronous storage of chat interactions into the vector database.
 */
export const memoryManager = {
  /**
   * Saves a completed chat exchange to memory
   */
  saveChatToMemory: async (payload: ChatMemoryPayload): Promise<void> => {
    const { userMessage, aiResponse, sessionId, chatId } = payload

    // Check if memory is enabled
    const isMemoryEnabled = await readSetting(SETTINGS.MEMORY_ENABLED)
    if (!isMemoryEnabled) {
      return
    }

    try {
      // Store User Message
      await storeChatMessage(userMessage, {
        role: "user",
        sessionId,
        chatId
      })

      // Store AI Response
      await storeChatMessage(aiResponse, {
        role: "assistant",
        sessionId,
        chatId
      })

      logger.info("Saved chat exchange for session", "memoryManager", {
        sessionId
      })
    } catch (error) {
      logger.error("Failed to save chat to memory", "memoryManager", { error })
    }
  }
}
