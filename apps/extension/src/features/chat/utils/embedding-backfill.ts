import { db } from "@/lib/db"
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

export const getEmbeddableMessagesBySession = async (): Promise<{
  messagesBySession: Map<string, ChatMessage[]>
  totalMessages: number
}> => {
  const messagesBySession = new Map<string, ChatMessage[]>()
  let totalMessages = 0

  let useLegacySessions = false

  try {
    const count = await db.messages.count()
    if (count === 0) {
      useLegacySessions = true
    } else {
      const allMessages = await db.messages.toArray()
      for (const message of allMessages) {
        if (!isEmbeddableChatMessage(message)) continue
        const sessionId = message.sessionId
        if (!sessionId) continue
        const list = messagesBySession.get(sessionId) || []
        list.push(message)
        messagesBySession.set(sessionId, list)
        totalMessages += 1
      }
    }
  } catch {
    useLegacySessions = true
  }

  if (useLegacySessions) {
    const sessions = await db.sessions.toArray()
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
