import { useCallback } from "react"
import { useTranslation } from "react-i18next"
import { chatSessionStore } from "@/features/sessions/stores/chat-session-store"
import { useToast } from "@/hooks/use-toast"
import { logger } from "@/lib/logger"
import { bulkPutSessions } from "@/lib/repositories/chat-history"
import type { ChatSession } from "@/types"
import { salvageImportedSession } from "@/types/chat.schemas"

interface ImportSummary {
  importedSessions: number
  skippedSessions: number
  droppedMessages: number
  invalidFiles: number
}

export const useImportChat = () => {
  const { t } = useTranslation()
  const { toast } = useToast()

  const importChat = useCallback(
    async (files: FileList | null) => {
      if (!files) return

      const importedSessions: ChatSession[] = []
      const summary: ImportSummary = {
        importedSessions: 0,
        skippedSessions: 0,
        droppedMessages: 0,
        invalidFiles: 0
      }

      const now = Date.now()
      const makeId = () => crypto.randomUUID()

      for (const file of Array.from(files)) {
        if (!file.name.endsWith(".json")) continue

        try {
          const text = await file.text()
          let raw: unknown
          try {
            raw = JSON.parse(text)
          } catch {
            summary.invalidFiles++
            logger.warn("File is not valid JSON", "useImportChat", {
              fileName: file.name
            })
            continue
          }

          const rawSessions = Array.isArray(raw) ? raw : [raw]

          for (const item of rawSessions) {
            // Salvage rather than discard: keep the session even when some
            // messages or sub-attachments are malformed, defaulting missing
            // scalars. Only a session with nothing rescuable is skipped.
            const salvaged = salvageImportedSession(item, now, makeId)
            if (salvaged) {
              importedSessions.push(salvaged.session as unknown as ChatSession)
              summary.droppedMessages += salvaged.droppedMessages
            } else {
              summary.skippedSessions++
              logger.warn(
                "Skipping unrescuable session in file",
                "useImportChat",
                { fileName: file.name }
              )
            }
          }
        } catch (err) {
          summary.invalidFiles++
          logger.error("Failed to import file", "useImportChat", {
            fileName: file.name,
            error: err
          })
        }
      }

      summary.importedSessions = importedSessions.length

      if (importedSessions.length > 0) {
        await bulkPutSessions(importedSessions)

        chatSessionStore.setState((state) => ({
          sessions: [...importedSessions, ...state.sessions],
          currentSessionId: state.currentSessionId ?? importedSessions[0].id,
          hasSession: true,
          hydrated: true
        }))
      }

      // Always surface the outcome. Silent skips are how an empty import used
      // to masquerade as success.
      const hadProblems =
        summary.skippedSessions > 0 ||
        summary.droppedMessages > 0 ||
        summary.invalidFiles > 0

      if (importedSessions.length === 0) {
        toast({
          variant: "destructive",
          title: t("sessions.import.toast.failed_title"),
          description: t("sessions.import.toast.failed_description")
        })
      } else if (hadProblems) {
        toast({
          variant: "destructive",
          title: t("sessions.import.toast.partial_title", {
            count: summary.importedSessions
          }),
          description: t("sessions.import.toast.partial_description", {
            skipped: summary.skippedSessions,
            droppedMessages: summary.droppedMessages,
            invalidFiles: summary.invalidFiles
          })
        })
      } else {
        toast({
          title: t("sessions.import.toast.success_title", {
            count: summary.importedSessions
          })
        })
      }

      return summary
    },
    [t, toast]
  )

  return { importChat }
}
