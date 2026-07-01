import { useSessionMetricsPreference } from "@/features/chat/hooks/use-session-metrics-preference"
import { EmbeddingStatusIndicator } from "@/features/model/components/embedding-status-indicator"
import { ProviderStatusIndicator } from "@/features/model/components/provider-status-indicator"
import { ChatSessionSelector } from "@/features/sessions/components/chat-session-selector"
import { useChatSessions } from "@/features/sessions/stores/chat-session-store"
import type { ChatMessage } from "@/types"
import { SessionMetricsBar } from "./session-metrics-bar"

/**
 * ChatHeader - Top bar with session selector and status indicators
 * Extracted from Chat component to improve modularity
 */
export const ChatHeader = ({ messages }: { messages: ChatMessage[] }) => {
  const { currentSessionId } = useChatSessions()
  const [showSessionMetrics] = useSessionMetricsPreference()

  return (
    <div className="sticky top-0 z-30 px-2 pt-2">
      <div className="flex items-center justify-between rounded-panel bg-background/85 backdrop-blur p-0.5 shadow-xs">
        <ChatSessionSelector />
        {currentSessionId && showSessionMetrics && (
          <SessionMetricsBar messages={messages} />
        )}
        <div className="flex items-center gap-2">
          <EmbeddingStatusIndicator />
          <ProviderStatusIndicator />
        </div>
      </div>
    </div>
  )
}
