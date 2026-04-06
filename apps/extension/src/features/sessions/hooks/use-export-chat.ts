import { useTranslation } from "react-i18next"
import { db } from "@/lib/db"
import { jsonExporter } from "@/lib/exporters/json-exporter"
import { markdownExporter } from "@/lib/exporters/markdown-exporter"
import { pdfExporter } from "@/lib/exporters/pdf-exporter"
import { textExporter } from "@/lib/exporters/text-exporter"
import type { ChatSession } from "@/types"

export const useChatExport = () => {
  const { t } = useTranslation()

  // Helper to ensure we have all messages
  const getFullSession = async (session: ChatSession): Promise<ChatSession> => {
    // If we suspect messages are incomplete (e.g. pagination), fetch all
    // Since we don't track "total count" easily on the session object without querying,
    // and exports are rare actions, let's just safe-fetch all messages for validity.
    // However, to save bandwidth, we could check if we are in a "paginated" state.
    // For now, ALWAYS fetch from DB to ensure export is complete.
    const messages = await db.messages
      .where("sessionId")
      .equals(session.id)
      .sortBy("timestamp")

    // Create map of ID to message for attaching files
    const messageKeys = messages.map((m) => m.id as number)
    const files = await db.files.where("messageId").anyOf(messageKeys).toArray()

    const messagesWithFiles = messages.map((msg) => ({
      ...msg,
      attachments: files.filter((f) => f.messageId === msg.id)
    }))

    return { ...session, messages: messagesWithFiles }
  }

  const exportSessionAsJson = async (
    session: ChatSession,
    fileName?: string
  ) => {
    const fullSession = await getFullSession(session)
    jsonExporter.exportSession(fullSession, t, { fileName })
  }

  const exportAllSessionsAsJson = async (sessions: ChatSession[]) => {
    // For "All Sessions", we probably want to iterate and fetch full details for each
    const fullSessions = await Promise.all(sessions.map(getFullSession))
    jsonExporter.exportAllSessions(fullSessions, t)
  }

  const exportSessionAsPdf = async (
    session: ChatSession,
    fileName?: string
  ) => {
    const fullSession = await getFullSession(session)
    pdfExporter.exportSession(fullSession, t, { fileName })
  }

  const exportAllSessionsAsPdf = async (sessions: ChatSession[]) => {
    const fullSessions = await Promise.all(sessions.map(getFullSession))
    pdfExporter.exportAllSessions(fullSessions, t)
  }

  const exportSessionAsMarkdown = async (
    session: ChatSession,
    fileName?: string
  ) => {
    const fullSession = await getFullSession(session)
    markdownExporter.exportSession(fullSession, t, { fileName })
  }

  const exportAllSessionsAsMarkdown = async (sessions: ChatSession[]) => {
    const fullSessions = await Promise.all(sessions.map(getFullSession))
    markdownExporter.exportAllSessions(fullSessions, t)
  }

  const exportSessionAsText = async (
    session: ChatSession,
    fileName?: string
  ) => {
    const fullSession = await getFullSession(session)
    textExporter.exportSession(fullSession, t, { fileName })
  }

  const exportAllSessionsAsText = async (sessions: ChatSession[]) => {
    const fullSessions = await Promise.all(sessions.map(getFullSession))
    textExporter.exportAllSessions(fullSessions, t)
  }

  return {
    exportSessionAsJson,
    exportAllSessionsAsJson,
    exportSessionAsPdf,
    exportAllSessionsAsPdf,
    exportSessionAsMarkdown,
    exportAllSessionsAsMarkdown,
    exportSessionAsText,
    exportAllSessionsAsText
  }
}
