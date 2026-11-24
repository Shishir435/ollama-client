import type { ChatMessage } from "@/types"

/**
 * Whether a failed answer kept text the model had already written. A failure
 * with nothing to keep stores its own explanation as the message body, so a
 * body that is not that explanation is output; the explanation then rides in
 * `error.userMessage`.
 */
export const hasPartialOutput = (message: ChatMessage): boolean => {
  if (!message.error) return false
  const body = message.content.trim()
  return body.length > 0 && body !== (message.error.userMessage ?? "").trim()
}
