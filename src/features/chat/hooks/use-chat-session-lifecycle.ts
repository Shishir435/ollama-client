import type { ChatSession } from "@/types"

interface ChatSessionLifecycleOptions {
  currentSessionId: string | null
  sessions: ChatSession[]
  createSession: () => Promise<string>
  setCurrentSessionId: (sessionId: string) => void
  renameSessionTitle: (sessionId: string, title: string) => Promise<void>
}

export const useChatSessionLifecycle = ({
  currentSessionId,
  sessions,
  createSession,
  setCurrentSessionId,
  renameSessionTitle
}: ChatSessionLifecycleOptions) => {
  const ensureSessionId = async (): Promise<string | null> => {
    if (
      currentSessionId &&
      sessions.some((session) => session.id === currentSessionId)
    ) {
      return currentSessionId
    }
    const sessionId = await createSession()
    setCurrentSessionId(sessionId)
    return sessionId
  }

  const autoRenameSession = async (sessionId: string, content: string) => {
    const currentTitle = sessions.find((s) => s.id === sessionId)?.title
    // `undefined` means the session was just created (via ensureSessionId) and
    // isn't in this render's `sessions` snapshot yet — its title is still the
    // default "New Chat", so renaming is safe. This is the omnibox path, where
    // a fresh session is created and sent to in the same turn.
    if (currentTitle === "New Chat" || currentTitle === undefined) {
      // Store a generous, mostly-untrimmed title and let CSS handle the visible
      // truncation in the sidebar (see chat-session-item). The 100-char cap only
      // bounds DB/search size; it is not the display width.
      const firstLine = content.split("\n")[0].trim().slice(0, 100)
      if (firstLine) await renameSessionTitle(sessionId, firstLine)
    }
  }

  return { ensureSessionId, autoRenameSession }
}
