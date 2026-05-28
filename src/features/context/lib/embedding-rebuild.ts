import type { ChatMessage } from "@/types"

export interface RebuildProgress {
  current: number
  total: number
}

export interface RebuildEmbeddingsOptions {
  memoryEnabled: boolean
  clearEmbeddingCache: () => void
  clearAllVectors: () => Promise<unknown>
  getEmbeddableMessagesBySession: () => Promise<{
    messagesBySession: Map<string, ChatMessage[]>
    totalMessages: number
  }>
  embedMessages: (messages: ChatMessage[], sessionId: string) => Promise<void>
  onProgress?: (progress: RebuildProgress) => void
  pauseMs?: number
}

export const rebuildEmbeddings = async ({
  memoryEnabled,
  clearEmbeddingCache,
  clearAllVectors,
  getEmbeddableMessagesBySession,
  embedMessages,
  onProgress,
  pauseMs = 100
}: RebuildEmbeddingsOptions): Promise<RebuildProgress> => {
  clearEmbeddingCache()

  if (!memoryEnabled) {
    await clearAllVectors()
    const progress = { current: 0, total: 0 }
    onProgress?.(progress)
    return progress
  }

  const { messagesBySession, totalMessages } =
    await getEmbeddableMessagesBySession()
  let processedMessages = 0

  onProgress?.({ current: 0, total: totalMessages })
  await clearAllVectors()

  for (const [sessionId, messages] of messagesBySession.entries()) {
    if (messages.length === 0) continue

    await embedMessages(messages, sessionId)
    processedMessages += messages.length

    onProgress?.({
      current: processedMessages,
      total: totalMessages
    })

    if (pauseMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, pauseMs))
    }
  }

  return {
    current: processedMessages,
    total: totalMessages
  }
}
