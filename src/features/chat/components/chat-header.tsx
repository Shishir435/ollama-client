import type { ReactNode } from "react"
import { useSessionMetricsPreference } from "@/features/chat/hooks/use-session-metrics-preference"
import { EmbeddingStatusIndicator } from "@/features/model/components/embedding-status-indicator"
import { ProviderStatusIndicator } from "@/features/model/components/provider-status-indicator"
import { PrivacyStatusChip } from "@/features/privacy/components/privacy-status-chip"
import { ChatSessionSelector } from "@/features/sessions/components/chat-session-selector"
import { useChatSessions } from "@/features/sessions/stores/chat-session-store"
import type { ChatMessage } from "@/types"
import { SessionMetricsBar } from "./session-metrics-bar"
import { SessionSystemPromptButton } from "./session-system-prompt-button"

/**
 * The chat surface's top bar: the surface switch, the session selector, this
 * session's metrics and the status indicators.
 *
 * `leading` is where the side panel puts the Chat/Agent switch. It used to
 * have a full-width row above this one, which spent forty pixels of a
 * four-hundred-pixel surface on a two-item toggle and put the mode a person is
 * in one row away from the state that mode is in.
 */
export const ChatHeader = ({
  messages,
  leading
}: {
  messages: ChatMessage[]
  leading?: ReactNode
}) => {
  const { currentSessionId } = useChatSessions()
  const [showSessionMetrics] = useSessionMetricsPreference()

  return (
    <div className="sticky top-0 z-30 px-2 pt-2">
      <div className="flex min-w-0 items-center gap-1 rounded-panel bg-background/85 backdrop-blur p-0.5 shadow-xs">
        {leading}
        <ChatSessionSelector />
        {currentSessionId && showSessionMetrics && (
          <SessionMetricsBar messages={messages} />
        )}
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <PrivacyStatusChip />
          <SessionSystemPromptButton />
          <EmbeddingStatusIndicator />
          <ProviderStatusIndicator />
        </div>
      </div>
    </div>
  )
}
