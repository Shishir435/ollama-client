import { useState } from "react"
import { ChatMessageContainer } from "@/features/chat/components/chat-message-container"
import { ChatMessageContent } from "@/features/chat/components/chat-message-content"
import { ChatMessageEditor } from "@/features/chat/components/chat-message-editor"
import { ChatMessageFooter } from "@/features/chat/components/chat-message-footer"
import type { ChatMessage } from "@/types"

export const ChatMessageBubble = ({
  msg,
  onRegenerate,
  isLoading,
  onUpdate,
  onDelete,
  onNavigate
}: {
  msg: ChatMessage
  onRegenerate?: (model: string) => void
  isLoading?: boolean
  onUpdate?: (content: string) => void
  onDelete?: () => void
  onNavigate?: (nodeId: number) => void
}) => {
  const [isEditing, setIsEditing] = useState(false)
  const isUser = msg.role === "user"

  const handleSave = (newContent: string) => {
    onUpdate?.(newContent)
    setIsEditing(false)
  }

  const handleExport = () => {
    const blob = new Blob([msg.content], { type: "text/plain" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `message-${msg.id || "export"}.txt`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  return (
    <ChatMessageContainer isUser={isUser}>
      {isEditing ? (
        <ChatMessageEditor
          initialContent={msg.content}
          onSave={handleSave}
          onCancel={() => setIsEditing(false)}
        />
      ) : (
        <>
          <ChatMessageContent msg={msg} isUser={isUser} />
          <ChatMessageFooter
            isUser={isUser}
            msg={msg}
            isLoading={isLoading}
            onRegenerate={onRegenerate}
            onEdit={() => setIsEditing(true)}
            onDelete={onDelete}
            onExport={handleExport}
            onNavigate={onNavigate}
          />
        </>
      )}
    </ChatMessageContainer>
  )
}
