import { useCallback } from "react"
import { z } from "zod"
import { chatSessionStore } from "@/features/sessions/stores/chat-session-store"
import { logger } from "@/lib/logger"
import { bulkPutSessions } from "@/lib/repositories/chat-history"
import type { ChatSession } from "@/types"
import { ChatSessionImportSchema } from "@/types/chat.schemas"

export const useImportChat = () => {
  const importChat = useCallback(async (files: FileList | null) => {
    if (!files) return

    const importedSessions: ChatSession[] = []
    const ImportPayload = z.union([
      z.array(ChatSessionImportSchema),
      ChatSessionImportSchema.transform((s) => [s])
    ])

    for (const file of Array.from(files)) {
      if (!file.name.endsWith(".json")) continue

      try {
        const text = await file.text()
        const parsed = ImportPayload.safeParse(JSON.parse(text))

        if (!parsed.success) {
          logger.warn("Invalid session data in file", "useImportChat", {
            fileName: file.name,
            error: parsed.error.message
          })
          continue
        }

        importedSessions.push(...(parsed.data as ChatSession[]))
      } catch (err) {
        logger.error("Failed to parse import file", "useImportChat", {
          fileName: file.name,
          error: err
        })
      }
    }

    if (importedSessions.length > 0) {
      await bulkPutSessions(importedSessions)

      chatSessionStore.setState((state) => ({
        sessions: [...importedSessions, ...state.sessions],
        currentSessionId: state.currentSessionId ?? importedSessions[0].id,
        hasSession: true
      }))
    }
  }, [])

  return { importChat }
}
