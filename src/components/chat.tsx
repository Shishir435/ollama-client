import ChatInputBox from "@/components/chat-input-box"
import ChatMessageBubble from "@/components/chat-message-bubble"
import ChatSessionSelector from "@/components/chat-session-selector"
import { ScrollArea } from "@/components/ui/scroll-area"
import WelcomeScreen from "@/components/welcome-screen"
import { useChat } from "@/hooks/use-chat"
import { useLoadStream } from "@/context/load-stream-context"

export default function Chat() {
  const { messages, sendMessage, stopGeneration, scrollRef } = useChat()
  const { isLoading, isStreaming } = useLoadStream()

  const getMessageMargin = (currentIndex: number): string => {
    if (currentIndex === 0) return "mt-2"
    const prev = messages[currentIndex - 1]
    const curr = messages[currentIndex]
    return prev.role !== curr.role ? "mt-4" : "mt-1"
  }

  return (
    <div className="flex h-screen flex-col rounded-md p-1">
      <div className="fixed left-0 top-0 z-50">
        <ChatSessionSelector />
      </div>
      {messages.length === 0 ? (
        <WelcomeScreen />
      ) : (
        <ScrollArea className="flex-1 px-2 scrollbar-none">
          {messages.map((msg, idx) => (
            <div key={idx} className={getMessageMargin(idx)}>
              <ChatMessageBubble
                msg={msg}
                isLoading={
                  isLoading &&
                  msg.role === "assistant" &&
                  idx === messages.length - 1
                }
                onRegenerate={
                  msg.role === "assistant"
                    ? (model) => {
                        if (isLoading || isStreaming) return
                        const prevUser = [...messages.slice(0, idx)]
                          .reverse()
                          .find((m) => m.role === "user")
                        if (prevUser) sendMessage(prevUser.content, model)
                      }
                    : undefined
                }
              />
            </div>
          ))}
          <div ref={scrollRef} />
        </ScrollArea>
      )}
      <div className="sticky bottom-0 z-10 w-full bg-background pt-2">
        <ChatInputBox onSend={sendMessage} stopGeneration={stopGeneration} />
      </div>
    </div>
  )
}
