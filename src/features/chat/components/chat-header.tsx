import { SemanticChatSearchButton } from "@/features/chat/components/semantic-chat-search-button"
import { EmbeddingStatusIndicator } from "@/features/model/components/embedding-status-indicator"
import { OllamaStatusIndicator } from "@/features/model/components/ollama-status-indicator"
import { ChatExportButton } from "@/features/sessions/components/chat-export-button"
import { ChatSessionSelector } from "@/features/sessions/components/chat-session-selector"
import { useChatSessions } from "@/features/sessions/stores/chat-session-store"

/**
 * ChatHeader - Top bar with session selector and status indicators
 * Extracted from Chat component to improve modularity
 */
export const ChatHeader = () => {
  const { currentSessionId } = useChatSessions()

  return (
    <>
      <div className="fixed left-2 top-2 z-50">
        <ChatSessionSelector searchTrigger={<SemanticChatSearchButton />} />
      </div>
      <div className="fixed right-2 top-2 z-50 flex items-center gap-2">
        {currentSessionId && <ChatExportButton sessionId={currentSessionId} />}
        <EmbeddingStatusIndicator />
        <OllamaStatusIndicator />
      </div>
    </>
  )
}
