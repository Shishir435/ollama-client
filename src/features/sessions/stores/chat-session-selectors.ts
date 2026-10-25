import { useEffect, useMemo } from "react"
import { useShallow } from "zustand/react/shallow"
import type { ChatSession } from "@/types"
import { chatSessionStore } from "./chat-session-store"

/** Cached metadata belongs to the external-store selector, outside React render. */
const createSessionSelector = (includeMessages: boolean) => {
  let previous: ChatSession[] = []
  return (sessions: ChatSession[]) => {
    if (includeMessages) return sessions
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
      previous = next
    return previous
  }
}

export const useChatSessions = (includeMessages = true) => {
  // Keep Zustand shallow selection as the existing memoization boundary.
  "use no memo"

  const selectSessions = useMemo(
    () => createSessionSelector(includeMessages),
    [includeMessages]
  )

  const store = chatSessionStore(
    useShallow((s) => ({
      sessions: selectSessions(s.sessions),
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
