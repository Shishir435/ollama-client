import {
  countMessages,
  getAllSessions,
  getMessagesPaginated
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
    const count = await countMessages()
    if (count === 0) {
      useLegacySessions = true
    } else {
      for (let offset = 0; ; offset += MESSAGE_PAGE_SIZE) {
        const page = await getMessagesPaginated(offset, MESSAGE_PAGE_SIZE)
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
      }
    }
  } catch {
    useLegacySessions = true
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
