import { ChatMessageContainer } from "@/features/chat/components/chat-message-container"
import { ChatMessageContent } from "@/features/chat/components/chat-message-content"
import { ChatMessageFooter } from "@/features/chat/components/chat-message-footer"
import type { ChatMessage } from "@/types"

export const ChatMessageBubble = ({
  msg,
  onRegenerate,
  isLoading
}: {
  msg: ChatMessage
  onRegenerate?: (model: string) => void
  isLoading?: boolean
}) => {
  const isUser = msg.role === "user"

  return (
    <ChatMessageContainer isUser={isUser}>
      <ChatMessageContent msg={msg} isUser={isUser} />
      <ChatMessageFooter
        isUser={isUser}
        msg={msg}
        isLoading={isLoading}
        onRegenerate={onRegenerate}
      />
    </ChatMessageContainer>
  )
}
