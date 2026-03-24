import { useStorage } from "@plasmohq/storage/hook"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
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
  const [userDetachedFromBottom, setUserDetachedFromBottom] = useState(false)
  const restoreBottomTimeoutRef = useRef<number | null>(null)
  const [embeddingConfig] = useStorage<EmbeddingConfig>(
    {
      key: STORAGE_KEYS.EMBEDDINGS.CONFIG,
      instance: plasmoGlobalStorage
    },
    DEFAULT_EMBEDDING_CONFIG
  )
  const filteredMessages = useMemo(
    () => messages.filter((msg) => msg.role !== "system"),
    [messages]
  )
  const lastVirtualIndex = firstItemIndex + filteredMessages.length - 1
  const internalMessagesRef = useRef(filteredMessages)
  const showRetrievedChunks =
    embeddingConfig?.showRetrievedChunks ??
    DEFAULT_EMBEDDING_CONFIG.showRetrievedChunks
  const feedbackEnabled =
    embeddingConfig?.feedbackEnabled ?? DEFAULT_EMBEDDING_CONFIG.feedbackEnabled

  useEffect(() => {
    const newMessages = filteredMessages
    const oldMessages = internalMessagesRef.current

    if (newMessages.length > oldMessages.length) {
      const diff = newMessages.length - oldMessages.length
      // specific check for prepend: if the old first message is now at index `diff`
      const isPrepend =
        oldMessages.length > 0 && newMessages[diff] === oldMessages[0]

      if (isPrepend) {
        setFirstItemIndex((prev) => prev - diff)
      }
    }

    internalMessagesRef.current = newMessages
  }, [filteredMessages])

  useEffect(() => {
    return () => {
      if (restoreBottomTimeoutRef.current !== null) {
        window.clearTimeout(restoreBottomTimeoutRef.current)
        restoreBottomTimeoutRef.current = null
      }
    }
  }, [])

  const handleAtBottomStateChange = useCallback((bottom: boolean) => {
    if (restoreBottomTimeoutRef.current !== null) {
      window.clearTimeout(restoreBottomTimeoutRef.current)
      restoreBottomTimeoutRef.current = null
    }

    if (!bottom) {
      setIsAtBottom((prev) => (prev ? false : prev))
      setUserDetachedFromBottom((prev) => (prev ? prev : true))
      return
    }

    // Avoid bottom-edge oscillation by only restoring after stable bottom.
    restoreBottomTimeoutRef.current = window.setTimeout(() => {
      setIsAtBottom((prev) => (prev ? prev : true))
      setUserDetachedFromBottom((prev) => (prev ? false : prev))
      restoreBottomTimeoutRef.current = null
    }, 300)
  }, [])

  return (
    <div className="relative flex-1 h-full px-4 py-2">
      <Virtuoso
        ref={virtuosoRef}
        firstItemIndex={firstItemIndex}
        data={filteredMessages}
        initialTopMostItemIndex={lastVirtualIndex}
        startReached={() => {
          if (hasMore) {
            onLoadMore()
          }
        }}
        followOutput={isStreaming && !userDetachedFromBottom ? "smooth" : false}
        alignToBottom={false}
        className="scrollbar-none"
        atBottomThreshold={24}
        atBottomStateChange={handleAtBottomStateChange}
        computeItemKey={(index, msg) =>
          msg.id !== undefined
            ? String(msg.id)
            : `${msg.role}:${String(msg.timestamp ?? index)}`
        }
        components={{
          // Optional: Header/Footer if needed
          Footer: () => <div className="h-28 sm:h-32" />
        }}
        itemContent={(index, msg) => {
          // Convert virtuoso absolute index into local array index.
          const relativeIndex = index - firstItemIndex
          const isLastAssistantMessage =
            msg.role === "assistant" &&
            relativeIndex === filteredMessages.length - 1

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
            <div className={`${className} rounded-lg pr-2`}>
              <ChatMessageBubble
                msg={msg}
                isLoading={isLoading && isLastAssistantMessage}
                isStreaming={isStreaming && isLastAssistantMessage}
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
      {userDetachedFromBottom && !isAtBottom && filteredMessages.length > 0 && (
        <div className="pointer-events-none absolute bottom-4 right-4">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="pointer-events-auto h-8 gap-1 rounded-full px-3 text-xs shadow-md"
            onClick={() => {
              if (restoreBottomTimeoutRef.current !== null) {
                window.clearTimeout(restoreBottomTimeoutRef.current)
                restoreBottomTimeoutRef.current = null
              }
              setUserDetachedFromBottom(false)
              setIsAtBottom(true)
              virtuosoRef.current?.scrollToIndex({
                index: lastVirtualIndex,
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
