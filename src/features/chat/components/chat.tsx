import { ScrollArea } from "@/components/ui/scroll-area"
import { ChatInputBox } from "@/features/chat/components/chat-input-box"
import { ChatMessageBubble } from "@/features/chat/components/chat-message-bubble"
import { useChat } from "@/features/chat/hooks/use-chat"
import { useLoadStream } from "@/features/chat/stores/load-stream-store"
import { OllamaStatusIndicator } from "@/features/model/components/ollama-status-indicator"
import { ChatSessionSelector } from "@/features/sessions/components/chat-session-selector"
import { useChatSessions } from "@/features/sessions/stores/chat-session-store"
import { WelcomeScreen } from "@/sidepanel/components/welcome-screen"

export const Chat = () => {
  const { messages, sendMessage, stopGeneration, scrollRef } = useChat()
  const { isLoading, isStreaming } = useLoadStream()
  const { currentSessionId } = useChatSessions()

  const getMessageMargin = (
    currentIndex: number,
    filteredMessages: typeof messages
  ): string => {
    if (currentIndex === 0) return "mt-3"
    const prev = filteredMessages[currentIndex - 1]
    const curr = filteredMessages[currentIndex]
    return prev.role !== curr.role ? "mt-6" : "mt-2"
  }

  const hasSession = !!currentSessionId

  return (
    <div className="flex h-screen flex-col rounded-lg bg-gradient-to-br from-background via-background to-background/95 p-1">
      <div className="fixed left-2 top-2 z-50">
        <ChatSessionSelector />
      </div>
      <div className="fixed right-2 top-2 z-50">
        <OllamaStatusIndicator />
      </div>

      {hasSession ? (
        <ScrollArea className="flex-1 px-4 py-2 scrollbar-none">
          <div className="mx-auto max-w-4xl">
            {messages
              .filter((msg) => msg.role !== "system")
              .map((msg, idx, filteredMessages) => (
                <div
                  key={idx}
                  className={getMessageMargin(idx, filteredMessages)}>
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
                            const prevUser = [...filteredMessages.slice(0, idx)]
                              .reverse()
                              .find((m) => m.role === "user")
                            if (prevUser) sendMessage(prevUser.content, model)
                          }
                        : undefined
                    }
                  />
                </div>
              ))}
            <div ref={scrollRef} className="h-4" />
          </div>
        </ScrollArea>
      ) : (
        <WelcomeScreen />
      )}

      {hasSession && (
        <div className="sticky bottom-0 z-10 w-full border-t border-border/30 bg-background/80 pb-2 pt-3 backdrop-blur-md">
          <div className="mx-auto max-w-4xl px-2">
            <ChatInputBox
              onSend={sendMessage}
              stopGeneration={stopGeneration}
            />
          </div>
        </div>
      )}
    </div>
  )
}
