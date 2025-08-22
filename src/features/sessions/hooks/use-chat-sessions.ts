import { useEffect } from "react"

import { useShallow } from "zustand/react/shallow"

import { chatSessionStore } from "@/features/sessions/stores/chat-session-store"

export const useChatSessions = () => {
  const store = chatSessionStore(
    useShallow((s) => ({
      sessions: s.sessions,
      currentSessionId: s.currentSessionId,
      hasSession: s.hasSession,
      createSession: s.createSession,
      deleteSession: s.deleteSession,
      updateMessages: s.updateMessages,
      renameSessionTitle: s.renameSessionTitle,
      setCurrentSessionId: s.setCurrentSessionId,
      loadSessions: s.loadSessions
    }))
  )

  useEffect(() => {
    if (store.sessions.length === 0) {
      store.loadSessions()
    }
  }, [store.sessions.length, store.loadSessions])

  return store
}
