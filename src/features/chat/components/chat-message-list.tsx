import { useStorage } from "@plasmohq/storage/hook"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso"
import { TooltipActionButton } from "@/components/actions"
import {
  DEFAULT_EMBEDDING_CONFIG,
  type EmbeddingConfig,
  STORAGE_KEYS
} from "@/lib/constants"
import { ChevronDown } from "@/lib/lucide-icon"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"
import { cn } from "@/lib/utils"
import type { ActivityEvent, ChatMessage } from "@/types"
import { ChatMessageBubble } from "./chat-message-bubble"

export interface ChatMessageListProps {
  messages: ChatMessage[]
  pendingActivityEvents?: ActivityEvent[]
  isLoading: boolean
  isStreaming: boolean
  highlightedMessage: ChatMessage | null
  onRegenerate: (message: ChatMessage, model?: string) => void
  onUpdateMessage: (message: ChatMessage, content: string) => void
  onForkMessage: (message: ChatMessage, content: string) => void
  onDeleteMessage: (message: ChatMessage) => void
  onNavigate?: (nodeId: number | string) => void
  hasMore: boolean
  onLoadMore: () => void
}

const ChatListFooter = () => <div className="h-28 sm:h-32" />

const virtuosoComponents = {
  Footer: ChatListFooter
}

export const ChatMessageList = ({
  messages,
  pendingActivityEvents,
  isLoading,
  isStreaming,
  highlightedMessage,
  onRegenerate,
  hasMore,
  onLoadMore,
  onUpdateMessage,
  onForkMessage,
  onDeleteMessage,
  onNavigate
}: ChatMessageListProps) => {
  const { t } = useTranslation()
  const [firstItemIndex, setFirstItemIndex] = useState(10000)
  const virtuosoRef = useRef<VirtuosoHandle>(null)
  const [isAtBottom, setIsAtBottom] = useState(true)
  const [userDetachedFromBottom, setUserDetachedFromBottom] = useState(false)
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
  // While context is being built (loading, before the stream shell exists),
  // append a transient assistant bubble so the "Thinking…" trace shows
  // immediately instead of after the pre-stream work finishes.
  const displayMessages = useMemo(() => {
    const last = filteredMessages[filteredMessages.length - 1]
    if (isLoading && !isStreaming && last?.role === "user") {
      return [
        ...filteredMessages,
        {
          role: "assistant" as const,
          content: "",
          id: "__pending_assistant__",
          timestamp: last.timestamp,
          metrics:
            pendingActivityEvents && pendingActivityEvents.length > 0
              ? { activityEvents: pendingActivityEvents }
              : undefined
        }
      ]
    }
    return filteredMessages
  }, [filteredMessages, isLoading, isStreaming, pendingActivityEvents])
  const lastVirtualIndex = firstItemIndex + displayMessages.length - 1
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

  const handleAtBottomStateChange = useCallback((bottom: boolean) => {
    if (!bottom) {
      setIsAtBottom((prev) => (prev ? false : prev))
      setUserDetachedFromBottom((prev) => (prev ? prev : true))
      return
    }

    setIsAtBottom((prev) => (prev ? prev : true))
    setUserDetachedFromBottom((prev) => (prev ? false : prev))
  }, [])

  return (
    <div className="relative h-full flex-1 px-3 py-2 sm:px-4">
      <Virtuoso
        ref={virtuosoRef}
        firstItemIndex={firstItemIndex}
        data={displayMessages}
        initialTopMostItemIndex={lastVirtualIndex}
        startReached={() => {
          if (hasMore) {
            onLoadMore()
          }
        }}
        followOutput={isStreaming && !userDetachedFromBottom ? "auto" : false}
        alignToBottom={false}
        className="scrollbar-none"
        // Treat "within ~a few lines of the end" as at-bottom so the
        // scroll-to-bottom button doesn't show when a small gap remains.
        atBottomThreshold={120}
        atBottomStateChange={handleAtBottomStateChange}
        computeItemKey={(index, msg) =>
          msg.id !== undefined
            ? String(msg.id)
            : `${msg.role}:${String(msg.timestamp ?? index)}`
        }
        components={virtuosoComponents}
        itemContent={(index, msg) => {
          // Convert virtuoso absolute index into local array index.
          const relativeIndex = index - firstItemIndex
          const isLastAssistantMessage =
            msg.role === "assistant" &&
            relativeIndex === displayMessages.length - 1

          let paddingTop = "pt-2"
          if (relativeIndex === 0) paddingTop = "pt-3"
          else if (
            relativeIndex > 0 &&
            displayMessages[relativeIndex - 1]?.role !== msg.role
          )
            paddingTop = "pt-6"

          // Check for highlight
          const isHighlighted =
            highlightedMessage &&
            highlightedMessage.role === msg.role &&
            highlightedMessage.content === msg.content

          return (
            <div className={cn(paddingTop, "pr-2")}>
              <div
                className={
                  isHighlighted ? "rounded-panel bg-app-primary-soft/70" : ""
                }>
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
                  onFork={(content) => onForkMessage(msg, content)}
                  onDelete={() => onDeleteMessage(msg)}
                  onNavigate={onNavigate}
                />
              </div>
            </div>
          )
        }}
      />
      {userDetachedFromBottom && !isAtBottom && filteredMessages.length > 0 && (
        <div className="pointer-events-none absolute bottom-4 right-4">
          <TooltipActionButton
            type="button"
            size="icon"
            variant="secondary"
            label={t("chat.scroll_to_bottom")}
            className="pointer-events-auto size-8 rounded-full border border-border/60 shadow-md"
            icon={<ChevronDown className="icon-sm" />}
            onClick={() => {
              setUserDetachedFromBottom(false)
              setIsAtBottom(true)
              virtuosoRef.current?.scrollToIndex({
                index: lastVirtualIndex,
                align: "end",
                behavior: "smooth"
              })
            }}
          />
        </div>
      )}
    </div>
  )
}
