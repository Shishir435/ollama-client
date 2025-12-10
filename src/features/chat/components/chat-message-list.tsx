import { useEffect } from "react"
import { ScrollArea } from "@/components/ui/scroll-area"
import { ChatMessageBubble } from "@/features/chat/components/chat-message-bubble"
import type { ChatMessage } from "@/types"

interface ChatMessageListProps {
  messages: ChatMessage[]
  isLoading: boolean
  isStreaming: boolean
  highlightedMessage: ChatMessage | null
  setHighlightedMessage: (msg: ChatMessage | null) => void
  scrollRef: React.RefObject<HTMLDivElement>
  onRegenerate: (message: ChatMessage, model?: string) => void
}

/**
 * ChatMessageList - Renders the list of chat messages with scrolling and highlighting
 * Extracted from Chat component to improve modularity and testability
 */
export const ChatMessageList = ({
  messages,
  isLoading,
  isStreaming,
  highlightedMessage,
  setHighlightedMessage,
  scrollRef,
  onRegenerate
}: ChatMessageListProps) => {
  // Effect to handle message highlighting and scroll-to-view
  useEffect(() => {
    if (highlightedMessage && messages.length > 0) {
      // Find the message index
      const index = messages.findIndex(
        (m) =>
          m.role === highlightedMessage.role &&
          m.content === highlightedMessage.content
      )

      if (index !== -1) {
        // Wait a bit for the DOM to update
        setTimeout(() => {
          const element = document.getElementById(`message-${index}`)
          if (element) {
            element.scrollIntoView({ behavior: "smooth", block: "center" })
            // Add a temporary highlight effect
            element.classList.add("bg-accent/20")
            setTimeout(() => {
              element.classList.remove("bg-accent/20")
              // Clear the highlighted message
              setHighlightedMessage(null)
            }, 2000)
          }
        }, 100)
      }
    }
  }, [highlightedMessage, messages, setHighlightedMessage])

  // Effect to auto-scroll to bottom on new messages
  // biome-ignore lint/correctness/useExhaustiveDependencies: messages needed for auto-scroll on new messages
  useEffect(() => {
    // Only scroll to bottom if we're NOT trying to highlight a message
    if (!highlightedMessage) {
      scrollRef.current?.scrollIntoView({ behavior: "smooth" })
    }
  }, [messages, highlightedMessage, scrollRef])

  // Utility function to calculate margin between messages
  const getMessageMargin = (
    currentIndex: number,
    filteredMessages: ChatMessage[]
  ): string => {
    if (currentIndex === 0) return "mt-3"
    const prev = filteredMessages[currentIndex - 1]
    const curr = filteredMessages[currentIndex]
    return prev.role !== curr.role ? "mt-6" : "mt-2"
  }

  // Filter out system messages
  const filteredMessages = messages.filter((msg) => msg.role !== "system")

  return (
    <ScrollArea className="flex-1 px-4 py-2 scrollbar-none">
      <div className="mx-auto max-w-4xl">
        {filteredMessages.map((msg, idx) => (
          <div
            id={`message-${idx}`}
            key={`${msg.role}-${idx}-${msg.content.slice(0, 10)}`}
            className={`${getMessageMargin(idx, filteredMessages)} transition-colors duration-500 rounded-lg`}>
            <ChatMessageBubble
              msg={msg}
              isLoading={
                isLoading &&
                msg.role === "assistant" &&
                idx === filteredMessages.length - 1
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
        ))}
        <div ref={scrollRef} className="h-4" />
      </div>
    </ScrollArea>
  )
}
