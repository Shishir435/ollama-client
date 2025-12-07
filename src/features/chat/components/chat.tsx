import { useEffect } from "react"
import { ScrollArea } from "@/components/ui/scroll-area"
import { ChatInputBox } from "@/features/chat/components/chat-input-box"
import { ChatMessageBubble } from "@/features/chat/components/chat-message-bubble"
import { SemanticChatSearchButton } from "@/features/chat/components/semantic-chat-search-button"
import { SemanticChatSearchDialog } from "@/features/chat/components/semantic-chat-search-dialog"
import { useChat } from "@/features/chat/hooks/use-chat"
import { useSpeechSynthesis } from "@/features/chat/hooks/use-speech-synthesis"
import { useLoadStream } from "@/features/chat/stores/load-stream-store"
import { EmbeddingStatusIndicator } from "@/features/model/components/embedding-status-indicator"
import { OllamaStatusIndicator } from "@/features/model/components/ollama-status-indicator"
import { ChatSessionSelector } from "@/features/sessions/components/chat-session-selector"
import { useChatSessions } from "@/features/sessions/stores/chat-session-store"
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts"
import browser from "@/lib/browser-api"
import { WelcomeScreen } from "@/sidepanel/components/welcome-screen"
import { useSearchDialogStore } from "@/stores/search-dialog-store"
import { useThemeStore } from "@/stores/theme"

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

  const { toggle: toggleSpeech } = useSpeechSynthesis()

  useKeyboardShortcuts({
    newChat: (e) => {
      e.preventDefault()
      createSession()
    },
    settings: (e) => {
      e.preventDefault()
      browser.runtime.openOptionsPage()
    },
    toggleTheme: (e) => {
      e.preventDefault()
      const { theme, setTheme } = useThemeStore.getState()
      const nextTheme = theme === "dark" ? "light" : "dark"
      setTheme(nextTheme)
    },
    toggleSpeech: (e) => {
      e.preventDefault()
      const lastAssistantMessage = [...messages]
        .reverse()
        .find((m) => m.role === "assistant")

      if (lastAssistantMessage) {
        toggleSpeech(lastAssistantMessage.content)
      }
    },
    searchMessages: (e) => {
      e.preventDefault()
      useSearchDialogStore.getState().openSearchDialog()
    },
    clearChat: (e) => {
      e.preventDefault()
      if (currentSessionId && confirm("Clear this chat session?")) {
        deleteSession(currentSessionId)
        createSession()
      }
    },
    copyLastResponse: (e) => {
      e.preventDefault()
      const lastAssistantMessage = [...messages]
        .reverse()
        .find((m) => m.role === "assistant")
      if (lastAssistantMessage) {
        navigator.clipboard.writeText(lastAssistantMessage.content)
      }
    }
  })

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

  // biome-ignore lint/correctness/useExhaustiveDependencies: messages needed for auto-scroll on new messages
  useEffect(() => {
    // Only scroll to bottom if we're NOT trying to highlight a message
    if (!highlightedMessage) {
      scrollRef.current?.scrollIntoView({ behavior: "smooth" })
    }
  }, [messages, highlightedMessage, scrollRef])

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
        <ChatSessionSelector searchTrigger={<SemanticChatSearchButton />} />
      </div>
      <div className="fixed right-2 top-2 z-50 flex items-center gap-2">
        <EmbeddingStatusIndicator />
        <OllamaStatusIndicator />
      </div>

      {hasSession ? (
        <ScrollArea className="flex-1 px-4 py-2 scrollbar-none">
          <div className="mx-auto max-w-4xl">
            {messages
              .filter((msg) => msg.role !== "system")
              .map((msg, idx, filteredMessages) => (
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
              messages={messages}
              onSend={sendMessage}
              stopGeneration={stopGeneration}
            />
          </div>
        </div>
      )}
      <SemanticChatSearchDialog
        open={isSearchOpen}
        onClose={closeSearchDialog}
        currentSessionId={currentSessionId}
      />
    </div>
  )
}
