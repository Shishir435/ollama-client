import type { ReactNode } from "react"
import { useSessionMetricsPreference } from "@/features/chat/hooks/use-session-metrics-preference"
import { EmbeddingStatusIndicator } from "@/features/model/components/embedding-status-indicator"
import { ProviderStatusIndicator } from "@/features/model/components/provider-status-indicator"
import { ChatSessionSelector } from "@/features/sessions/components/chat-session-selector"
import { useChatSessions } from "@/features/sessions/stores/chat-session-store"
import type { ChatMessage } from "@/types"
import { SessionMetricsBar } from "./session-metrics-bar"

/**
 * The chat surface's top bar: the surface switch, the session selector, this
 * session's metrics and the status indicators.
 *
 * The privacy chip is gone. It read "Local" whenever the endpoint was a
 * loopback address, which a proxy forwarding to a hosted model also is, so the
 * one word it had to say was the thing it could not actually know. The chat
 * instruction moved to the context sheet, where the rest of what gets sent
 * with a message already lives.
 *
 * The metrics sit in a centred middle column between two equal side columns,
 * so they stay at the bar's centre however wide the session selector or the
 * indicators are, and their popover opens under the middle of the panel.
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
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-1 rounded-panel bg-surface-overlay backdrop-blur p-0.5 shadow-xs">
        <div className="flex min-w-0 items-center gap-1">
          {leading}
          <ChatSessionSelector />
        </div>
        <div className="flex min-w-0 justify-center">
          {currentSessionId && showSessionMetrics && (
            <SessionMetricsBar messages={messages} />
          )}
        </div>
        <div className="flex shrink-0 items-center justify-end gap-1.5">
          <EmbeddingStatusIndicator />
          <ProviderStatusIndicator />
        </div>
      </div>
    </div>
  )
}
