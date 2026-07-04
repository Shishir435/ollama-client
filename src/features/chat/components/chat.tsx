import { useState } from "react"
import { useTranslation } from "react-i18next"
import { ConfirmActionDialog } from "@/components/settings/confirm-action-dialog"
import { AgentRunHeader } from "@/features/agent/components/agent-run-header"
import { useAutoEmbedMessages } from "@/features/chat/hooks/use-auto-embed-messages"
import { useChat } from "@/features/chat/hooks/use-chat"
import { useChatKeyboardShortcuts } from "@/features/chat/hooks/use-chat-keyboard-shortcuts"
import { useOmniboxQuery } from "@/features/chat/hooks/use-omnibox-query"
import { useLoadStream } from "@/features/chat/stores/load-stream-store"
import { useChatSessions } from "@/features/sessions/stores/chat-session-store"
import { WelcomeScreen } from "@/sidepanel/components/welcome-screen"
import { useSearchDialogStore } from "@/stores/search-dialog-store"
import type { ChatMessage } from "@/types"
import { ChatHeader } from "./chat-header"
import { ChatInputBox } from "./chat-input-box"
import { ChatMessageList } from "./chat-message-list"
import { PendingToolConfirmation } from "./pending-tool-confirmation"
import { SemanticChatSearchDialog } from "./semantic-chat-search-dialog"

export const Chat = () => {
  const { t } = useTranslation()
  const {
    messages,
    pendingActivityEvents,
    sendMessage,
    generateResponse,
    stopGeneration,
    isModelReady,
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
  const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null)
  const [agentMode, setAgentMode] = useState(false)

  // Omnibox quick-ask ("olc <query>") plumbing lives in its own hook to keep
  // the chat UI decoupled from address-bar integration.
  useOmniboxQuery({ sendMessage, isModelReady })

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
    if (message.content === content) return
    if (typeof message.id !== "number") return

    await updateMessage(message.id, { content })
    if (currentSessionId) {
      await embedMessage({ ...message, content }, currentSessionId)
    }
  }

  const handleForkMessage = async (message: ChatMessage, content: string) => {
    if (
      message.role !== "user" ||
      typeof message.id !== "number" ||
      !currentSessionId
    ) {
      return
    }

    const newLeafId = await forkMessage(currentSessionId, message.id, content)
    const messageIndex = messages.findIndex((item) => item.id === message.id)
    if (messageIndex !== -1 && newLeafId) {
      const newMessage = { ...message, id: newLeafId, content }
      await embedMessage(newMessage, currentSessionId)
      await generateResponse(undefined, currentSessionId, [
        ...messages.slice(0, messageIndex),
        newMessage
      ])
    }
  }

  // window.confirm can be silently suppressed inside an extension side panel,
  // so route deletes through the shared in-app confirm dialog instead.
  const handleDeleteMessage = (message: ChatMessage) => {
    if (typeof message.id !== "number") return
    setPendingDeleteId(message.id)
  }

  const confirmDeleteMessage = async () => {
    if (pendingDeleteId === null) return
    await deleteMessage(pendingDeleteId)
    setPendingDeleteId(null)
  }

  const handleNavigateBranch = async (nodeId: number | string) => {
    if (currentSessionId) {
      await navigateToNode(currentSessionId, nodeId)
    }
  }

  const hasSession = !!currentSessionId

  return (
    <div className="flex h-screen flex-col bg-surface-chat">
      <ChatHeader messages={messages} />

      {hasSession ? (
        <>
          <ChatMessageList
            messages={messages}
            pendingActivityEvents={pendingActivityEvents}
            isLoading={isLoading}
            isStreaming={isStreaming}
            highlightedMessage={highlightedMessage}
            onUpdateMessage={handleUpdateMessage}
            onForkMessage={handleForkMessage}
            onDeleteMessage={handleDeleteMessage}
            onRegenerate={handleRegenerate}
            hasMore={hasMore}
            onLoadMore={onLoadMore}
            onNavigate={handleNavigateBranch}
          />

          <div className="sticky bottom-0 z-10 w-full border-t border-border/30 bg-surface-chat/95 pb-2 pt-3 backdrop-blur">
            <PendingToolConfirmation messages={messages} />
            <div className="mx-auto max-w-4xl px-2">
              <AgentRunHeader
                enabled={agentMode}
                running={agentMode && (isLoading || isStreaming)}
                onEnabledChange={setAgentMode}
                onStop={stopGeneration}
              />
              <ChatInputBox
                onSend={sendMessage}
                stopGeneration={stopGeneration}
                agentMode={agentMode}
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
      <ConfirmActionDialog
        open={pendingDeleteId !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDeleteId(null)
        }}
        title={t("chat.actions.delete_confirm_title")}
        description={t("chat.actions.delete_confirm_description")}
        confirmLabel={t("chat.actions.delete")}
        destructive
        onConfirm={confirmDeleteMessage}
      />
    </div>
  )
}
