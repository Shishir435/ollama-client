import { useEffect } from "react"

import { useChatSessions } from "@/features/sessions/stores/chat-session-store"

export const useEnsureFirstSession = () => {
  const { sessions, currentSessionId, createSession, setCurrentSessionId } =
    useChatSessions()

  useEffect(() => {
    const ensure = async () => {
      if (sessions.length === 0) {
        await createSession()
      } else if (!currentSessionId) {
        setCurrentSessionId(sessions[0].id)
      }
    }
    ensure()
  }, [sessions, currentSessionId])
}
