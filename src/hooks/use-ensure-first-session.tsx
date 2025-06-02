import { useEffect } from "react"

import { useChatSessions } from "@/context/chat-session-context"
import { db } from "@/lib/db"

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
