import { ScrollArea } from "@/components/ui/scroll-area"
import { TooltipProvider } from "@/components/ui/tooltip"
import { useChat } from "@/hooks/use-chat"

import ChatInputBox from "./chat-input-box"
import ChatMessageBubble from "./chat-message-bubble"
import WelcomeScreen from "./welcome-screen"

export default function Chat() {
  const {
    input,
    setInput,
    messages,
    isLoading,
    sendMessage,
    stopGeneration,
    scrollRef
  } = useChat()

  const getMessageMargin = (currentIndex: number): string => {
    if (currentIndex === 0) return "mt-2"
    const prev = messages[currentIndex - 1]
    const curr = messages[currentIndex]
    return prev.role !== curr.role ? "mt-4" : "mt-1"
  }

  return (
    <TooltipProvider>
      <div className="flex h-screen flex-col rounded-md p-1">
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
          <ChatInputBox
            input={input}
            setInput={setInput}
            isLoading={isLoading}
            onSend={sendMessage}
            stopGeneration={stopGeneration}
          />
        </div>
      </div>
    </TooltipProvider>
  )
}
