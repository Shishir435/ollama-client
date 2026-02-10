import { useStorage } from "@plasmohq/storage/hook"
import { useRef, useState } from "react"
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso"
import { Button } from "@/components/ui/button"
import { ChatMessageBubble } from "@/features/chat/components/chat-message-bubble"
import {
  DEFAULT_EMBEDDING_CONFIG,
  type EmbeddingConfig,
  STORAGE_KEYS
} from "@/lib/constants"
import { ChevronDown } from "@/lib/lucide-icon"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"
import type { ChatMessage } from "@/types"

interface ChatMessageListProps {
  messages: ChatMessage[]
  isLoading: boolean
  isStreaming: boolean
  highlightedMessage: ChatMessage | null
  onRegenerate: (message: ChatMessage, model?: string) => void
  onUpdateMessage: (message: ChatMessage, content: string) => void
  onDeleteMessage: (message: ChatMessage) => void
  onNavigate?: (nodeId: number | string) => void
  hasMore: boolean
  onLoadMore: () => void
}

export const ChatMessageList = ({
  messages,
  isLoading,
  isStreaming,
  highlightedMessage,
  onRegenerate,
  hasMore,
  onLoadMore,
  onUpdateMessage,
  onDeleteMessage,
  onNavigate
}: ChatMessageListProps) => {
  const [firstItemIndex, setFirstItemIndex] = useState(10000)
  const virtuosoRef = useRef<VirtuosoHandle>(null)
  const [isAtBottom, setIsAtBottom] = useState(true)
  const [embeddingConfig] = useStorage<EmbeddingConfig>(
    {
      key: STORAGE_KEYS.EMBEDDINGS.CONFIG,
      instance: plasmoGlobalStorage
    },
    DEFAULT_EMBEDDING_CONFIG
  )
  const filteredMessages = messages.filter((msg) => msg.role !== "system")
  const internalMessagesRef = useRef(filteredMessages)
  const showRetrievedChunks =
    embeddingConfig?.showRetrievedChunks ??
    DEFAULT_EMBEDDING_CONFIG.showRetrievedChunks
  const feedbackEnabled =
    embeddingConfig?.feedbackEnabled ?? DEFAULT_EMBEDDING_CONFIG.feedbackEnabled

  // Update firstItemIndex when prepending items to ensure stable indices
  if (filteredMessages.length > internalMessagesRef.current.length) {
    const newMessages = filteredMessages
    const oldMessages = internalMessagesRef.current
    const diff = newMessages.length - oldMessages.length

    // specific check for prepend: if the old first message is now at index `diff`
    const isPrepend =
      oldMessages.length > 0 && newMessages[diff] === oldMessages[0]

    if (isPrepend) {
      setFirstItemIndex((prev) => prev - diff)
    }
  }

  // Update ref after render
  internalMessagesRef.current = filteredMessages

  return (
    <div className="relative flex-1 h-full px-4 py-2">
      <Virtuoso
        ref={virtuosoRef}
        firstItemIndex={firstItemIndex}
        data={filteredMessages}
        initialTopMostItemIndex={filteredMessages.length - 1} // We'll rely on alignToBottom/followOutput mostly
        startReached={() => {
          if (hasMore) {
            onLoadMore()
          }
        }}
        followOutput={isStreaming ? "smooth" : "auto"} // Prioritize smooth scrolling during streaming
        alignToBottom={true} // Initial alignment
        className="scrollbar-none"
        atBottomThreshold={50} // Distance to trigger stick-to-bottom
        atBottomStateChange={(bottom) => setIsAtBottom(bottom)}
        components={{
          // Optional: Header/Footer if needed
          Footer: () => <div className="h-28 sm:h-32" />
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
                showRetrievedChunks={showRetrievedChunks}
                feedbackEnabled={feedbackEnabled}
                onRegenerate={
                  msg.role === "assistant"
                    ? (model) => {
                        if (isLoading || isStreaming) return
                        onRegenerate(msg, model)
                      }
                    : undefined
                }
                onUpdate={(content) => onUpdateMessage(msg, content)}
                onDelete={() => onDeleteMessage(msg)}
                onNavigate={onNavigate}
              />
            </div>
          )
        }}
      />
      {!isAtBottom && filteredMessages.length > 0 && (
        <div className="pointer-events-none absolute bottom-4 right-4">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="pointer-events-auto h-8 gap-1 rounded-full px-3 text-xs shadow-md"
            onClick={() => {
              virtuosoRef.current?.scrollToIndex({
                index: filteredMessages.length - 1,
                align: "end",
                behavior: "smooth"
              })
            }}>
            <ChevronDown className="h-3.5 w-3.5" />
            Bottom
          </Button>
        </div>
      )}
    </div>
  )
}
