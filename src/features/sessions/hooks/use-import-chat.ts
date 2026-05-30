import { useCallback } from "react"
import { chatSessionStore } from "@/features/sessions/stores/chat-session-store"
import { logger } from "@/lib/logger"
import { bulkPutSessions } from "@/lib/repositories/chat-history"
import type { ChatSession } from "@/types"
import { ChatSessionImportSchema } from "@/types/chat.schemas"

export const useImportChat = () => {
  const importChat = useCallback(async (files: FileList | null) => {
    if (!files) return

    const importedSessions: ChatSession[] = []

    for (const file of Array.from(files)) {
      if (!file.name.endsWith(".json")) continue

      try {
        const text = await file.text()
        let raw: unknown
        try {
          raw = JSON.parse(text)
        } catch {
          logger.warn("File is not valid JSON", "useImportChat", {
            fileName: file.name
          })
          continue
        }

        const rawSessions = Array.isArray(raw) ? raw : [raw]
        let fileHadErrors = false

        for (const item of rawSessions) {
          const parsed = ChatSessionImportSchema.safeParse(item)
          if (parsed.success) {
            importedSessions.push(parsed.data as unknown as ChatSession)
          } else {
            fileHadErrors = true
            logger.warn("Skipping invalid session in file", "useImportChat", {
              fileName: file.name,
              error: parsed.error.message
            })
          }
        }

        if (fileHadErrors) {
          logger.warn(
            "Some sessions were skipped due to validation errors",
            "useImportChat",
            { fileName: file.name }
          )
        }
      } catch (err) {
        logger.error("Failed to import file", "useImportChat", {
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
