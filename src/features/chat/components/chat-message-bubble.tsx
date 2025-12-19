import { useState } from "react"
import { ChatMessageContainer } from "@/features/chat/components/chat-message-container"
import { ChatMessageContent } from "@/features/chat/components/chat-message-content"
import { ChatMessageEditor } from "@/features/chat/components/chat-message-editor"
import { ChatMessageFooter } from "@/features/chat/components/chat-message-footer"
import { useMessageExport } from "@/features/chat/hooks/use-message-export"
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

  /* import { useMessageExport } from "@/features/chat/hooks/use-message-export" */

  const {
    exportMessageAsJson,
    exportMessageAsMarkdown,
    exportMessageAsPdf,
    exportMessageAsText
  } = useMessageExport()

  const handleExport = (format: "json" | "pdf" | "markdown" | "text") => {
    switch (format) {
      case "json":
        exportMessageAsJson(msg)
        break
      case "pdf":
        exportMessageAsPdf(msg)
        break
      case "markdown":
        exportMessageAsMarkdown(msg)
        break
      case "text":
        exportMessageAsText(msg)
        break
    }
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
