import { useEffect } from "react"
import { useShallow } from "zustand/react/shallow"
import { chatSessionStore } from "./chat-session-store"

export const useChatSessions = () => {
  const store = chatSessionStore(
    useShallow((s) => ({
      sessions: s.sessions,
      currentSessionId: s.currentSessionId,
      hasSession: s.hasSession,
      createSession: s.createSession,
      deleteSession: s.deleteSession,
      renameSessionTitle: s.renameSessionTitle,
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

  useEffect(() => {
    if (!store.sessions.length && !store.hasSession) {
      store.loadSessions()
    }
  }, [store.hasSession, store.loadSessions, store.sessions.length])

  return store
}
