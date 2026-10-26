import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { ConfirmActionDialog } from "@/components/settings/confirm-action-dialog"
import { useAutoEmbedMessages } from "@/features/chat/hooks/use-auto-embed-messages"
import { useChat } from "@/features/chat/hooks/use-chat"
import { useChatKeyboardShortcuts } from "@/features/chat/hooks/use-chat-keyboard-shortcuts"
import { useOmniboxQuery } from "@/features/chat/hooks/use-omnibox-query"
import { regenerateTurn } from "@/features/chat/lib/regenerate-turn"
import {
  type PermissionResumeResult,
  resumePermissionTurn
} from "@/features/chat/lib/resume-permission-turn"
import { usePendingChatSend } from "@/features/chat/stores/chat-input-store"
import { useLoadStream } from "@/features/chat/stores/load-stream-store"
import { hydrateMessageImages } from "@/features/sessions/lib/image-bytes"
import { useChatSessions } from "@/features/sessions/stores/chat-session-store"
import { cn } from "@/lib/class-names"
import { requestPermissions } from "@/lib/permissions"
import { writeSetting } from "@/lib/storage/setting-access"
import { SETTINGS } from "@/lib/storage/settings"
import { useSearchDialogStore } from "@/stores/search-dialog-store"
import type { ChatMessage } from "@/types"
import { ChatEmptyState } from "./chat-empty-state"
import { ChatHeader } from "./chat-header"
import { ChatInputBox } from "./chat-input-box"
import { ChatMessageList } from "./chat-message-list"
import { PendingToolConfirmation } from "./pending-tool-confirmation"
import { SemanticChatSearchDialog } from "./semantic-chat-search-dialog"

export const Chat = ({ embedded = false }: { embedded?: boolean }) => {
  const { t } = useTranslation()
  const {
    messages,
    pendingActivityEvents,
    sendMessage,
    generateResponse,
    claimResponseStream,
    releaseResponseStreamClaim,
    stopGeneration,
    isModelReady,
    hasMore,
    onLoadMore
  } = useChat()
  const { isLoading, isStreaming } = useLoadStream()
  const { pendingChatSend, clearPendingChatSend } = usePendingChatSend()
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
  const pendingSendInFlightRef = useRef(false)

  // Omnibox quick-ask ("olc <query>") plumbing lives in its own hook to keep
  // the chat UI decoupled from address-bar integration.
  useOmniboxQuery({ sendMessage, isModelReady })

  useEffect(() => {
    if (
      !currentSessionId ||
      !isModelReady ||
      isLoading ||
      isStreaming ||
      !pendingChatSend ||
      pendingSendInFlightRef.current
    ) {
      return
    }
    pendingSendInFlightRef.current = true
    void sendMessage(pendingChatSend)
      .then((accepted) => {
        if (accepted) clearPendingChatSend()
      })
      .catch(() => undefined)
      .finally(() => {
        pendingSendInFlightRef.current = false
      })
  }, [
    clearPendingChatSend,
    currentSessionId,
    isModelReady,
    isLoading,
    isStreaming,
    pendingChatSend,
    sendMessage
  ])

  // Handle all keyboard shortcuts
  useChatKeyboardShortcuts({
    messages,
    currentSessionId,
    createSession,
    deleteSession
  })

  const handleRegenerate = (
    message: (typeof messages)[number],
    model?: string
  ) =>
    regenerateTurn({
      message,
      messages,
      sessionId: currentSessionId,
      model,
      claimStream: claimResponseStream,
      releaseStreamClaim: releaseResponseStreamClaim,
      navigateToNode,
      generateResponse
    })

  const handleUpdateMessage = async (message: ChatMessage, content: string) => {
    if (!message.id) return
    if (message.content === content) return
    if (typeof message.id !== "number") return

    await updateMessage(message.id, { content })
    if (currentSessionId) {
      await embedMessage({ ...message, content }, currentSessionId)
    }
  }

  /**
   * The agent notice is a setting rather than a browser permission: turning
   * it on is a storage write, and "Continue without" sends the message as it
   * was. Every other notice asks the browser for its permission.
   */
  const handleResolvePermission = async (
    message: ChatMessage,
    enable = true
  ): Promise<PermissionResumeResult> =>
    resumePermissionTurn({
      message,
      messages,
      sessionId: currentSessionId,
      requestPermissions:
        message.metrics?.permissionNotice?.capabilityId === "browserAgent"
          ? async () => {
              if (enable) await writeSetting(SETTINGS.AGENT_ENABLED, true)
              return true
            }
          : requestPermissions,
      claimStream: claimResponseStream,
      releaseStreamClaim: releaseResponseStreamClaim,
      updateMessage,
      navigateToNode,
      generateResponse
    })

  const handleForkMessage = async (message: ChatMessage, content: string) => {
    if (
      isLoading ||
      isStreaming ||
      message.role !== "user" ||
      typeof message.id !== "number" ||
      !currentSessionId
    ) {
      return
    }

    const streamClaim = claimResponseStream()
    if (!streamClaim) return
    let submitted = false
    try {
      const messageIndex = messages.findIndex((item) => item.id === message.id)
      // Read the pictures first, so a failure leaves no half-made fork behind.
      const prior =
        messageIndex === -1
          ? []
          : await hydrateMessageImages(messages.slice(0, messageIndex))
      const newLeafId = await forkMessage(currentSessionId, message.id, content)
      if (messageIndex !== -1 && newLeafId) {
        const newMessage = { ...message, id: newLeafId, content }
        await embedMessage(newMessage, currentSessionId)
        submitted = await generateResponse(
          undefined,
          currentSessionId,
          [...prior, newMessage],
          { mode: "fork", streamClaim }
        )
      }
    } finally {
      if (!submitted) releaseResponseStreamClaim(streamClaim)
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

  /** A new chat, or none yet, shows the empty state until its first turn starts. */
  const showMessages =
    !!currentSessionId && (messages.length > 0 || isLoading || isStreaming)

  return (
    <div
      className={cn(
        "flex min-h-0 flex-col bg-surface-chat",
        embedded ? "h-full" : "h-screen"
      )}>
      <ChatHeader />

      {showMessages ? (
        <ChatMessageList
          messages={messages}
          sessionId={currentSessionId ?? undefined}
          pendingActivityEvents={pendingActivityEvents}
          isLoading={isLoading}
          isStreaming={isStreaming}
          highlightedMessage={highlightedMessage}
          onUpdateMessage={handleUpdateMessage}
          onForkMessage={handleForkMessage}
          onDeleteMessage={handleDeleteMessage}
          onResolvePermission={handleResolvePermission}
          onRegenerate={handleRegenerate}
          hasMore={hasMore}
          onLoadMore={onLoadMore}
          onNavigate={handleNavigateBranch}
        />
      ) : (
        <ChatEmptyState />
      )}

      <div className="sticky bottom-0 z-10 w-full border-t border-border-subtle bg-surface-chat/95 pb-2 pt-3 backdrop-blur">
        <PendingToolConfirmation messages={messages} />
        <div className="mx-auto max-w-4xl px-2">
          <ChatInputBox onSend={sendMessage} stopGeneration={stopGeneration} />
        </div>
      </div>
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
