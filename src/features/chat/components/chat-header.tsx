import { SemanticChatSearchButton } from "@/features/chat/components/semantic-chat-search-button"
import { EmbeddingStatusIndicator } from "@/features/model/components/embedding-status-indicator"
import { ProviderStatusIndicator } from "@/features/model/components/provider-status-indicator"
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
    <div className="sticky top-0 z-30 px-2 pt-2">
      <div className="flex items-center justify-between rounded-lg border border-border/40 bg-background px-2 py-2 shadow-xs">
        <ChatSessionSelector searchTrigger={<SemanticChatSearchButton />} />
        <div className="flex items-center gap-2">
          {currentSessionId && (
            <ChatExportButton sessionId={currentSessionId} />
          )}
          <EmbeddingStatusIndicator />
          <ProviderStatusIndicator />
        </div>
      </div>
    </div>
  )
}
