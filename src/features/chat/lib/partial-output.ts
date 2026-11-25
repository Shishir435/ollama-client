import type { ChatMessage } from "@/types"

/**
 * Whether a failed answer kept text the model had already written. A failure
 * with nothing to keep stores its own explanation as the message body — its
 * `userMessage`, or its `message` when it has none — so a body that is
 * neither is output.
 */
export const hasPartialOutput = (message: ChatMessage): boolean => {
  if (!message.error) return false
  const body = message.content.trim()
  if (!body) return false
  const explanations = [message.error.userMessage, message.error.message]
  return !explanations.some((text) => text?.trim() === body)
}
