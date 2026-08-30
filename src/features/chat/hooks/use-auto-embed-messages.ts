import { useCallback, useRef } from "react"
import { useSetting } from "@/hooks/use-setting"
import { chunkTextAsync } from "@/lib/embeddings/chunker"
import { getEmbeddingConfig } from "@/lib/embeddings/config"
import { assessContentQuality } from "@/lib/embeddings/content-quality-filter"
import { storeVector, vectorDb } from "@/lib/embeddings/vector-store"
import { logger } from "@/lib/logger"
import { SETTINGS } from "@/lib/storage/settings"
import { generateEmbedding } from "@/protocol/embedding-client"
import type { ChatMessage } from "@/types"

const checkDuplicateEmbedding = async (
  content: string,
  sessionId: string,
  messageId?: number,
  chunkIndex?: number
): Promise<boolean> => {
  try {
    const query = vectorDb.vectors.where("metadata.sessionId").equals(sessionId)
    if (messageId) {
      const existing = await query
        .filter((doc) =>
          chunkIndex === undefined
            ? doc.metadata.messageId === messageId
            : doc.metadata.messageId === messageId &&
              doc.metadata.chunkIndex === chunkIndex
        )
        .first()
      return Boolean(existing)
    }
    return Boolean(await query.filter((doc) => doc.content === content).first())
  } catch {
    return false
  }
}

const embeddableContent = (message: ChatMessage): string | null => {
  if (message.role === "system" || message.metrics?.permissionNotice)
    return null
  if (message.role === "assistant" && message.done !== true) return null
  const content = message.content?.trim()
  return content && content.length >= 10 ? content : null
}

const embedMessageChunks = async ({
  message,
  content,
  sessionId,
  qualityScore,
  qualityReasons
}: {
  message: ChatMessage
  content: string
  sessionId: string
  qualityScore: number
  qualityReasons: string[]
}): Promise<void> => {
  const embeddingConfig = await getEmbeddingConfig()
  const chunks = await chunkTextAsync(content, {
    chunkSize: embeddingConfig.chunkSize,
    chunkOverlap: embeddingConfig.chunkOverlap,
    strategy: embeddingConfig.chunkingStrategy
  })
  const messageId = typeof message.id === "number" ? message.id : undefined

  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index]
    if (
      await checkDuplicateEmbedding(chunk.text, sessionId, messageId, index)
    ) {
      continue
    }
    const result = await generateEmbedding(chunk.text)
    if ("error" in result) {
      logger.warn(
        "Failed to embed message chunk:",
        "useAutoEmbedMessages",
        result.error
      )
      continue
    }
    await storeVector(chunk.text, result.embedding, {
      type: "chat",
      source: "chat",
      sessionId,
      timestamp: Date.now(),
      title: message.role === "user" ? "User message" : "Assistant response",
      messageId,
      role: message.role,
      chunkIndex: index,
      totalChunks: chunks.length,
      qualityScore,
      qualityReasons: qualityReasons.join(", "),
      embeddingModel: result.model,
      embeddingProviderId: result.providerId,
      embeddingDim: result.embedding.length
    })
  }
}

export const useAutoEmbedMessages = () => {
  const [memoryEnabled] = useSetting(SETTINGS.MEMORY_ENABLED)
  const processingMessagesRef = useRef<Set<string>>(new Set())

  const embedMessage = useCallback(
    async (message: ChatMessage, sessionId: string): Promise<void> => {
      if (!memoryEnabled) return
      const content = embeddableContent(message)
      if (!content) return

      const qualityAssessment = assessContentQuality(content, message.role)
      if (!qualityAssessment.shouldEmbed) {
        logger.debug(
          `Skipping low-quality message (score: ${qualityAssessment.score.toFixed(2)})`,
          "useAutoEmbedMessages",
          {
            reasons: qualityAssessment.reasons,
            preview: content.substring(0, 50)
          }
        )
        return
      }

      const messageKey = `${sessionId}:${content}`
      if (processingMessagesRef.current.has(messageKey)) return
      processingMessagesRef.current.add(messageKey)

      try {
        await embedMessageChunks({
          message,
          content,
          sessionId,
          qualityScore: qualityAssessment.score,
          qualityReasons: qualityAssessment.reasons
        })
      } catch (error) {
        logger.error("Error embedding message:", "useAutoEmbedMessages", {
          error
        })
      } finally {
        setTimeout(() => {
          processingMessagesRef.current.delete(messageKey)
        }, 1000)
      }
    },
    [memoryEnabled]
  )

  const embedMessages = useCallback(
    async (
      messages: ChatMessage[],
      sessionId: string,
      isStreaming = false
    ): Promise<void> => {
      if (!memoryEnabled || isStreaming) return
      for (const message of messages.filter((msg) => embeddableContent(msg))) {
        await embedMessage(message, sessionId)
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
    },
    [memoryEnabled, embedMessage]
  )

  return { embedMessage, embedMessages, isEnabled: memoryEnabled }
}
