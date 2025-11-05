import { useStorage } from "@plasmohq/storage/hook"
import { useCallback, useRef } from "react"
import { STORAGE_KEYS } from "@/lib/constants"
import { generateEmbedding } from "@/lib/embeddings/ollama-embedder"
import { storeVector, vectorDb } from "@/lib/embeddings/vector-store"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"
import type { ChatMessage } from "@/types"

/**
 * Check if a message with the same content already exists for this session
 */
const checkDuplicateEmbedding = async (
  content: string,
  sessionId: string
): Promise<boolean> => {
  try {
    const existing = await vectorDb.vectors
      .where("metadata.sessionId")
      .equals(sessionId)
      .filter((doc) => doc.content === content)
      .first()
    return !!existing
  } catch {
    return false
  }
}

/**
 * Hook to automatically embed chat messages when they're saved
 * Embeds both user and assistant messages for semantic search
 * Prevents duplicate embeddings by tracking processed messages
 */
export const useAutoEmbedMessages = () => {
  const [autoEmbedEnabled] = useStorage<boolean>(
    {
      key: STORAGE_KEYS.EMBEDDINGS.AUTO_EMBED_CHAT,
      instance: plasmoGlobalStorage
    },
    true // Default to enabled
  )

  // Track messages currently being processed to avoid concurrent duplicates
  // Using ref to persist across renders without causing re-renders
  const processingMessagesRef = useRef<Set<string>>(new Set())

  const embedMessage = useCallback(
    async (message: ChatMessage, sessionId: string): Promise<void> => {
      // Skip if auto-embedding is disabled
      if (!autoEmbedEnabled) return

      // Skip system messages
      if (message.role === "system") return

      // Skip if message is empty or too short
      const content = message.content?.trim()
      if (!content || content.length < 10) return

      // Skip incomplete messages (assistant messages without done flag)
      // This prevents embedding partial streaming responses
      if (message.role === "assistant" && message.done !== true) {
        return
      }

      // Create a unique key for this message
      const messageKey = `${sessionId}:${content}`

      // Skip if already processing this message
      if (processingMessagesRef.current.has(messageKey)) {
        return
      }

      // Check for duplicate embedding
      const isDuplicate = await checkDuplicateEmbedding(content, sessionId)
      if (isDuplicate) {
        return // Skip if already embedded
      }

      // Mark as processing
      processingMessagesRef.current.add(messageKey)

      try {
        // Generate embedding
        const result = await generateEmbedding(content)

        if ("error" in result) {
          console.warn("Failed to embed message:", result.error)
          return
        }

        // Store vector with metadata
        // storeVector will also check for duplicates as a safety measure
        await storeVector(content, result.embedding, {
          type: "chat",
          sessionId,
          timestamp: Date.now(),
          title: message.role === "user" ? "User message" : "Assistant response"
        })
      } catch (error) {
        console.error("Error embedding message:", error)
        // Don't throw - embedding failures shouldn't block chat
      } finally {
        // Remove from processing set after a delay to allow for race conditions
        setTimeout(() => {
          processingMessagesRef.current.delete(messageKey)
        }, 1000)
      }
    },
    [autoEmbedEnabled]
  )

  const embedMessages = useCallback(
    async (
      messages: ChatMessage[],
      sessionId: string,
      isStreaming: boolean = false
    ): Promise<void> => {
      if (!autoEmbedEnabled) return

      // Skip if streaming - we'll embed when streaming completes
      if (isStreaming) return

      // Only embed completed messages (skip the last one if it's incomplete)
      const messagesToProcess = messages.filter((msg) => {
        // Skip system messages
        if (msg.role === "system") return false

        // Skip incomplete messages
        if (msg.role === "assistant" && msg.done !== true) return false

        // Skip empty or too short messages
        const content = msg.content?.trim()
        if (!content || content.length < 10) return false

        return true
      })

      // Process messages one by one with deduplication check
      for (const message of messagesToProcess) {
        await embedMessage(message, sessionId)
        // Small delay to avoid overwhelming the system
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
    },
    [autoEmbedEnabled, embedMessage]
  )

  return {
    embedMessage,
    embedMessages,
    isEnabled: autoEmbedEnabled
  }
}
