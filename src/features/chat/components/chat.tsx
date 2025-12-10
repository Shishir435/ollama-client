import { ChatHeader } from "@/features/chat/components/chat-header"
import { ChatInputBox } from "@/features/chat/components/chat-input-box"
import { ChatMessageList } from "@/features/chat/components/chat-message-list"
import { SemanticChatSearchDialog } from "@/features/chat/components/semantic-chat-search-dialog"
import { useChat } from "@/features/chat/hooks/use-chat"
import { useChatKeyboardShortcuts } from "@/features/chat/hooks/use-chat-keyboard-shortcuts"
import { useLoadStream } from "@/features/chat/stores/load-stream-store"
import { useChatSessions } from "@/features/sessions/stores/chat-session-store"
import { WelcomeScreen } from "@/sidepanel/components/welcome-screen"
import { useSearchDialogStore } from "@/stores/search-dialog-store"

export const Chat = () => {
  const { messages, sendMessage, stopGeneration, scrollRef } = useChat()
  const { isLoading, isStreaming } = useLoadStream()
  const {
    currentSessionId,
    highlightedMessage,
    setHighlightedMessage,
    createSession,
    deleteSession
  } = useChatSessions()
  const { isOpen: isSearchOpen, closeSearchDialog } = useSearchDialogStore()

  // Handle all keyboard shortcuts
  useChatKeyboardShortcuts({
    messages,
    currentSessionId,
    createSession,
    deleteSession
  })

  // Handle message regeneration
  const handleRegenerate = (
    message: (typeof messages)[number],
    model?: string
  ) => {
    const filteredMessages = messages.filter((msg) => msg.role !== "system")
    const messageIndex = filteredMessages.findIndex(
      (m) => m.role === message.role && m.content === message.content
    )

    if (messageIndex !== -1) {
      const prevUser = [...filteredMessages.slice(0, messageIndex)]
        .reverse()
        .find((m) => m.role === "user")
      if (prevUser) {
        sendMessage(prevUser.content, model)
      }
    }
  }

  const hasSession = !!currentSessionId

  return (
    <div className="flex h-screen flex-col rounded-lg bg-gradient-to-br from-background via-background to-background/95 p-1">
      <ChatHeader />

      {hasSession ? (
        <>
          <ChatMessageList
            messages={messages}
            isLoading={isLoading}
            isStreaming={isStreaming}
            highlightedMessage={highlightedMessage}
            setHighlightedMessage={setHighlightedMessage}
            scrollRef={scrollRef}
            onRegenerate={handleRegenerate}
          />

          <div className="sticky bottom-0 z-10 w-full border-t border-border/30 bg-background/80 pb-2 pt-3 backdrop-blur-md">
            <div className="mx-auto max-w-4xl px-2">
              <ChatInputBox
                messages={messages}
                onSend={sendMessage}
                stopGeneration={stopGeneration}
              />
            </div>
          </div>
        </>
      ) : (
        <WelcomeScreen />
      )}
      <SemanticChatSearchDialog
        open={isSearchOpen}
        onClose={closeSearchDialog}
        currentSessionId={currentSessionId}
      />
    </div>
  )
}
