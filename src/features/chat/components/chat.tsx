import { ChatHeader } from "@/features/chat/components/chat-header"
import { ChatInputBox } from "@/features/chat/components/chat-input-box"
import { ChatMessageList } from "@/features/chat/components/chat-message-list"
import { SemanticChatSearchDialog } from "@/features/chat/components/semantic-chat-search-dialog"
import { useAutoEmbedMessages } from "@/features/chat/hooks/use-auto-embed-messages"
import { useChat } from "@/features/chat/hooks/use-chat"
import { useChatKeyboardShortcuts } from "@/features/chat/hooks/use-chat-keyboard-shortcuts"
import { useLoadStream } from "@/features/chat/stores/load-stream-store"
import { useChatSessions } from "@/features/sessions/stores/chat-session-store"
import { WelcomeScreen } from "@/sidepanel/components/welcome-screen"
import { useSearchDialogStore } from "@/stores/search-dialog-store"
import type { ChatMessage } from "@/types"

export const Chat = () => {
  const {
    messages,
    sendMessage,
    generateResponse,
    stopGeneration,
    hasMore,
    onLoadMore
  } = useChat()
  const { isLoading, isStreaming } = useLoadStream()
  const {
    currentSessionId,
    highlightedMessage,
    createSession,
    deleteSession,
    updateMessage,
    deleteMessage,
    forkMessage,
    navigateToNode
  } = useChatSessions()
  const { isOpen: isSearchOpen, closeSearchDialog } = useSearchDialogStore()
  const { embedMessage } = useAutoEmbedMessages()

  // Handle all keyboard shortcuts
  useChatKeyboardShortcuts({
    messages,
    currentSessionId,
    createSession,
    deleteSession
  })

  // Handle message regeneration
  const handleRegenerate = async (
    message: (typeof messages)[number],
    model?: string
  ) => {
    /*
     * Regenerate means: "I want a new answer for the User message that triggered this Assistant message"
     * So we need to find the User message immediately preceding this Assistant message.
     */

    // Since 'messages' is the linear active path:
    const messageIndex = messages.findIndex((m) => m.id === message.id)
    if (messageIndex === -1) return

    // Find the closest preceding user message
    let prevUserIndex = -1
    for (let i = messageIndex - 1; i >= 0; i--) {
      if (messages[i].role === "user") {
        prevUserIndex = i
        break
      }
    }

    if (prevUserIndex !== -1 && currentSessionId) {
      const prevUserMsg = messages[prevUserIndex]

      /*
       * 1. Navigate to that user message (this sets it as the current leaf)
       * This is crucial: if we are regenerating an old message deep in history,
       * we must "rewind" the tip to the user message so the new assistant response is attached as a sibling of the old assistant response.
       */
      if (prevUserMsg.id) {
        // Pass true for 'exact' to ensure we stop AT the user message and don't forward to its old children.
        await navigateToNode(currentSessionId, prevUserMsg.id, true)
      }

      // 2. Prepare context (messages up to and including the user message)
      const contextMessages = messages.slice(0, prevUserIndex + 1)

      // 3. Trigger generation
      // If model is provided, use it (switching model for this specific branch)
      // Note: generateResponse will call addMessage, which automatically parents to currentLeafId (our user message)
      await generateResponse(model, currentSessionId, contextMessages)
    }
  }

  const handleUpdateMessage = async (message: ChatMessage, content: string) => {
    if (!message.id) return

    // If it's an assistant message, just update locally (no forking supported yet for assistant edits)
    // Or if content is same, ignore
    if (message.content === content) return

    if (message.role === "user") {
      if (currentSessionId) {
        /*
         * Forking Logic
         * 1. Fork the message (creates new branch)
         */
        const newLeafId = await forkMessage(
          currentSessionId,
          message.id,
          content
        )

        /*
         * 2. We need to trigger response generation for this new branch.
         * We need to construct the context history for the new branch.
         * We can do this by taking the messages up to the point of fork, and adding the new message.
         */
        const messageIndex = messages.findIndex((m) => m.id === message.id)
        if (messageIndex !== -1 && newLeafId) {
          const precedingMessages = messages.slice(0, messageIndex)
          const newMessage = { ...message, id: newLeafId, content }
          const contextMessages = [...precedingMessages, newMessage]

          // Ensure the new User message is embedded for semantic search!
          await embedMessage(newMessage, currentSessionId)

          await generateResponse(undefined, currentSessionId, contextMessages)
        }
      }
    } else {
      // Assistant or System: just update content
      await updateMessage(message.id, { content })
      if (currentSessionId) {
        const updatedMsg = { ...message, content }
        await embedMessage(updatedMsg, currentSessionId)
      }
    }
  }

  const handleDeleteMessage = async (message: ChatMessage) => {
    if (!message.id) return
    await deleteMessage(message.id)
  }

  const handleNavigateBranch = async (nodeId: number) => {
    if (currentSessionId) {
      await navigateToNode(currentSessionId, nodeId)
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
            onUpdateMessage={handleUpdateMessage}
            onDeleteMessage={handleDeleteMessage}
            onRegenerate={handleRegenerate}
            hasMore={hasMore}
            onLoadMore={onLoadMore}
            onNavigate={handleNavigateBranch}
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
