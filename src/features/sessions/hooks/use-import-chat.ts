import { useCallback } from "react"

import { db } from "@/lib/db"
import { chatSessionStore } from "@/features/sessions/stores/chat-session-store"
import type { ChatSession } from "@/types"

function isValidChatSession(obj: any): obj is ChatSession {
  if (!obj || typeof obj !== "object") return false
  return (
    typeof obj.id === "string" &&
    typeof obj.title === "string" &&
    typeof obj.createdAt === "number" &&
    typeof obj.updatedAt === "number" &&
    Array.isArray(obj.messages) &&
    obj.messages.every(
      (m: any) =>
        m && typeof m.role === "string" && typeof m.content === "string"
    )
  )
}

export const useImportChat = () => {
  const importChat = useCallback(async (files: FileList | null) => {
    if (!files) return

    const importedSessions: ChatSession[] = []

    for (const file of Array.from(files)) {
      if (!file.name.endsWith(".json")) continue

      try {
        const text = await file.text()
        const parsed = JSON.parse(text)

        const sessions = Array.isArray(parsed) ? parsed : [parsed]

        for (const s of sessions) {
          if (isValidChatSession(s)) {
            importedSessions.push(s)
          } else {
            console.warn(`Invalid session in file: ${file.name}`, s)
          }
        }
      } catch (err) {
        console.error(`Failed to parse ${file.name}:`, err)
      }
    }

    if (importedSessions.length > 0) {
      await db.sessions.bulkPut(importedSessions)

      chatSessionStore.setState((state) => ({
        sessions: [...importedSessions, ...state.sessions],
        currentSessionId: state.currentSessionId ?? importedSessions[0].id,
        hasSession: true
      }))
    }
  }, [])

  return { importChat }
}
