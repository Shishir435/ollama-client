import { useCallback } from "react"
import { chatSessionStore } from "@/features/sessions/stores/chat-session-store"
import { db } from "@/lib/db"
import { logger } from "@/lib/logger"
import type { ChatSession } from "@/types"

function isValidChatSession(obj: unknown): obj is ChatSession {
  if (!obj || typeof obj !== "object") return false
  const candidate = obj as Record<string, unknown>
  return (
    typeof candidate.id === "string" &&
    typeof candidate.title === "string" &&
    typeof candidate.createdAt === "number" &&
    typeof candidate.updatedAt === "number" &&
    Array.isArray(candidate.messages) &&
    candidate.messages.every(
      (m: unknown) =>
        m &&
        typeof m === "object" &&
        typeof (m as Record<string, unknown>).role === "string" &&
        typeof (m as Record<string, unknown>).content === "string"
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
            logger.warn("Invalid session in file", "useImportChat", {
              fileName: file.name,
              session: s
            })
          }
        }
      } catch (err) {
        logger.error("Failed to parse import file", "useImportChat", {
          fileName: file.name,
          error: err
        })
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
