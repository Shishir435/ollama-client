import { useEffect } from "react"

import { db } from "@/lib/db"
import { useChatSessions } from "@/features/sessions/context/chat-session-context"

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
