import { useEffect } from "react"
import { useShallow } from "zustand/react/shallow"
import type { ChatSession } from "@/types"
import { chatSessionStore } from "./chat-session-store"

const metadataBySessions = new WeakMap<ChatSession[], ChatSession[]>()
let previousMetadata: ChatSession[] = []

/** Share one projection per immutable store snapshot without retaining its messages. */
const selectSessionMetadata = (sessions: ChatSession[]): ChatSession[] => {
  const cached = metadataBySessions.get(sessions)
  if (cached) return cached
  const previous = previousMetadata
  const next = sessions.map(({ messages: _messages, ...metadata }, index) => {
    const old = previous[index]
    return old &&
      Object.keys(metadata).length === Object.keys(old).length &&
      Object.entries(metadata).every(
        ([key, value]) => old[key as keyof ChatSession] === value
      )
      ? old
      : metadata
  })
  if (
    next.length !== previous.length ||
    next.some((item, index) => item !== previous[index])
  )
    previousMetadata = next
  const result = previousMetadata
  metadataBySessions.set(sessions, result)
  return result
}

export const useChatSessions = (includeMessages = true) => {
  // Keep Zustand shallow selection as the existing memoization boundary.
  "use no memo"

  const store = chatSessionStore(
    useShallow((s) => ({
      sessions: includeMessages
        ? s.sessions
        : selectSessionMetadata(s.sessions),
      currentSessionId: s.currentSessionId,
      hasSession: s.hasSession,
      createSession: s.createSession,
      deleteSession: s.deleteSession,
      renameSessionTitle: s.renameSessionTitle,
      togglePinSession: s.togglePinSession,
      setSessionSystemPrompt: s.setSessionSystemPrompt,
      ...(s.setSessionTags ? { setSessionTags: s.setSessionTags } : {}),
      setCurrentSessionId: s.setCurrentSessionId,
      loadSessions: s.loadSessions,
      refreshSessions: s.refreshSessions,
      loadSessionMessages: s.loadSessionMessages,
      hasMoreMessages: s.hasMoreMessages,
      loadMoreMessages: s.loadMoreMessages,
      ensureMessageLoaded: s.ensureMessageLoaded,
      highlightedMessage: s.highlightedMessage,
      setHighlightedMessage: s.setHighlightedMessage,
      addMessage: s.addMessage,
      updateMessage: s.updateMessage,
      deleteMessage: s.deleteMessage,
      forkMessage: s.forkMessage,
      navigateToNode: s.navigateToNode
    }))
  )

  const { sessions, hasSession, loadSessions } = store
  useEffect(() => {
    if (!sessions.length && !hasSession) {
      loadSessions()
    }
  }, [hasSession, loadSessions, sessions.length])

  return store
}
