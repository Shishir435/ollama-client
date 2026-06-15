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
          logger.info("Parsing import file", "useImportChat", {
            fileName: file.name,
            isArray: Array.isArray(raw),
            sessionCount: rawSessions.length
          })

          for (const item of rawSessions) {
            // Salvage rather than discard: keep the session even when some
            // messages or sub-attachments are malformed, defaulting missing
            // scalars. Only a session with nothing rescuable is skipped.
            const outcome = salvageImportedSession(item, now, makeId)

            // Per-session diagnostics: exactly what was kept vs dropped, and
            // for every dropped message the field path that failed.
            logger.info("Salvage outcome", "useImportChat", {
              fileName: file.name,
              sessionId: outcome.sessionId,
              kept: outcome.session !== null,
              skipReason: outcome.skipReason,
              messagesIn: outcome.messagesIn,
              messagesKept: outcome.messagesKept,
              droppedMessages: outcome.droppedMessages,
              dropReasons: outcome.dropReasons
            })

            if (outcome.session) {
              importedSessions.push(outcome.session as unknown as ChatSession)
              summary.droppedMessages += outcome.droppedMessages
            } else {
              summary.skippedSessions++
              logger.warn(
                "Skipping unrescuable session in file",
                "useImportChat",
                {
                  fileName: file.name,
                  sessionId: outcome.sessionId,
                  skipReason: outcome.skipReason,
                  messagesIn: outcome.messagesIn,
                  dropReasons: outcome.dropReasons
                }
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

      logger.info("Import salvage complete", "useImportChat", {
        importedSessions: summary.importedSessions,
        skippedSessions: summary.skippedSessions,
        droppedMessages: summary.droppedMessages,
        invalidFiles: summary.invalidFiles
      })

      if (importedSessions.length > 0) {
        // Persist + store update are wrapped: a throw here (e.g. a DB
        // constraint) previously escaped unhandled, leaving salvaged sessions
        // neither persisted nor surfaced. Log it and fall through to the
        // failure toast instead.
        try {
          await bulkPutSessions(importedSessions)

          chatSessionStore.setState((state) => ({
            sessions: [...importedSessions, ...state.sessions],
            currentSessionId: state.currentSessionId ?? importedSessions[0].id,
            hasSession: true,
            hydrated: true
          }))
          logger.info("Imported sessions persisted", "useImportChat", {
            count: importedSessions.length,
            ids: importedSessions.map((s) => s.id)
          })
        } catch (err) {
          logger.error("Failed to persist imported sessions", "useImportChat", {
            error: err,
            count: importedSessions.length
          })
          summary.importedSessions = 0
          importedSessions.length = 0
        }
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
