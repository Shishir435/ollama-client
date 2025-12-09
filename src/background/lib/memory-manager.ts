import { STORAGE_KEYS } from "@/lib/constants"
import { storeChatMessage } from "@/lib/embeddings/vector-store"
import { logger } from "@/lib/logger"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"

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
    const isMemoryEnabled = await plasmoGlobalStorage.get<boolean>(
      STORAGE_KEYS.MEMORY.ENABLED
    )
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
