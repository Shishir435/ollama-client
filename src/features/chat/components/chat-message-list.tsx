import { useEffect, useRef, useState } from "react"
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso"
import { ChatMessageBubble } from "@/features/chat/components/chat-message-bubble"
import { useThemeStore } from "@/stores/theme"
import type { ChatMessage } from "@/types"

interface ChatMessageListProps {
  messages: ChatMessage[]
  isLoading: boolean
  isStreaming: boolean
  highlightedMessage: ChatMessage | null
  /* eslint-disable @typescript-eslint/no-unused-vars */
  setHighlightedMessage: (msg: ChatMessage | null) => void // Kept for interface compatibility
  onRegenerate: (message: ChatMessage, model?: string) => void
  hasMore: boolean
  onLoadMore: () => void
}

export const ChatMessageList = ({
  messages,
  isLoading,
  isStreaming,
  highlightedMessage,
  // setHighlightedMessage, // Unused
  onRegenerate,
  hasMore,
  onLoadMore
}: ChatMessageListProps) => {
  const virtuosoRef = useRef<VirtuosoHandle>(null)
  // const { theme } = useThemeStore() // Unused

  // We calculate first item index dynamically to handle prepending
  // const [firstItemIndex, setFirstItemIndex] = useState(1000000)

  // Effect to manage scroll or other state if needed
  // useEffect(() => { ... }, [messages.length]) - The previous effect just set unused state.

  // Filter out system messages
  const filteredMessages = messages.filter((msg) => msg.role !== "system")

  return (
    <div className="flex-1 px-4 py-2 h-full">
      <Virtuoso
        ref={virtuosoRef}
        firstItemIndex={10000000 - filteredMessages.length}
        data={filteredMessages}
        initialTopMostItemIndex={filteredMessages.length - 1}
        startReached={() => {
          if (hasMore) {
            onLoadMore()
          }
        }}
        followOutput={isStreaming ? "smooth" : "auto"} // Prioritize smooth scrolling during streaming
        alignToBottom={true} // Initial alignment
        className="scrollbar-none"
        atBottomThreshold={50} // Distance to trigger stick-to-bottom
        components={{
          // Optional: Header/Footer if needed
          Footer: () => <div className="h-4" />
        }}
        itemContent={(index, msg) => {
          // Calculate relative index since we use firstItemIndex to handle prepending
          const firstIndex = 10000000 - filteredMessages.length
          const relativeIndex = index - firstIndex

          // Calculate margins - logic moved inside
          let className = "mt-2"
          if (relativeIndex === 0) className = "mt-3"
          else if (
            relativeIndex > 0 &&
            filteredMessages[relativeIndex - 1]?.role !== msg.role
          )
            className = "mt-6"

          // Check for highlight
          const isHighlighted =
            highlightedMessage &&
            highlightedMessage.role === msg.role &&
            highlightedMessage.content === msg.content

          if (isHighlighted) {
            className += " bg-accent/20"
          }

          return (
            <div
              className={`${className} transition-colors duration-500 rounded-lg pr-2`}>
              <ChatMessageBubble
                msg={msg}
                isLoading={
                  isLoading &&
                  msg.role === "assistant" &&
                  index === filteredMessages.length - 1
                }
                onRegenerate={
                  msg.role === "assistant"
                    ? (model) => {
                        if (isLoading || isStreaming) return
                        onRegenerate(msg, model)
                      }
                    : undefined
                }
              />
            </div>
          )
        }}
      />
    </div>
  )
}
