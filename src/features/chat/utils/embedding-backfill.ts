import {
  countMessages,
  getAllSessions,
  getMessagesAfterId
} from "@/lib/repositories/chat-history"
import type { ChatMessage } from "@/types"

export const isEmbeddableChatMessage = (message: ChatMessage): boolean => {
  if (message.role === "system") return false

  const content = message.content?.trim()
  if (!content || content.length < 10) return false

  if (message.role === "assistant" && message.done !== true) {
    return false
  }

  return true
}

/**
 * Rows per read. One `SELECT *` over a year of chats was a single owner reply
 * holding every message, 85 MB of text at 98k messages, before the filter below
 * discarded most of it.
 */
const MESSAGE_PAGE_SIZE = 2000

export const getEmbeddableMessagesBySession = async (): Promise<{
  messagesBySession: Map<string, ChatMessage[]>
  totalMessages: number
}> => {
  const messagesBySession = new Map<string, ChatMessage[]>()
  let totalMessages = 0

  let useLegacySessions = false

  try {
    useLegacySessions = (await countMessages()) === 0
  } catch {
    useLegacySessions = true
  }

  if (!useLegacySessions) {
    // A read failing part-way propagates. Returning the pages already read
    // would let a rebuild clear every vector and re-embed only that part.
    for (let afterId = 0; ;) {
      const page = await getMessagesAfterId(afterId, MESSAGE_PAGE_SIZE)
      for (const message of page) {
        if (!isEmbeddableChatMessage(message)) continue
        const sessionId = message.sessionId
        if (!sessionId) continue
        const list = messagesBySession.get(sessionId) || []
        list.push(message)
        messagesBySession.set(sessionId, list)
        totalMessages += 1
      }
      if (page.length < MESSAGE_PAGE_SIZE) break
      afterId = Number(page[page.length - 1].id)
    }
  }

  if (useLegacySessions) {
    const sessions = await getAllSessions()
    for (const session of sessions) {
      if (!session.messages || session.messages.length === 0) continue
      const embeddable = session.messages.filter(isEmbeddableChatMessage)
      if (embeddable.length === 0) continue
      messagesBySession.set(session.id, embeddable)
      totalMessages += embeddable.length
    }
  }

  return { messagesBySession, totalMessages }
}
