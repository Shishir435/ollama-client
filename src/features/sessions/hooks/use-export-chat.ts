import { useTranslation } from "react-i18next"
import { splitStoredFiles } from "@/features/sessions/lib/message-tree"
import {
  getFilesByMessageIds,
  getMessagesBySessionOrderedByTimestamp
} from "@/lib/repositories/chat-history"
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
    const messages = await getMessagesBySessionOrderedByTimestamp(session.id)

    // Create map of ID to message for attaching files
    const messageKeys = messages.map((m) => m.id as number)
    const files = await getFilesByMessageIds(messageKeys)

    const messagesWithFiles = messages.map((msg) => {
      const { attachments, images } = splitStoredFiles(
        files.filter((f) => f.messageId === msg.id)
      )
      return {
        ...msg,
        attachments,
        images: images.length > 0 ? images : undefined
      }
    })

    return { ...session, messages: messagesWithFiles }
  }

  const exportSessionAsJson = async (
    session: ChatSession,
    fileName?: string
  ) => {
    const fullSession = await getFullSession(session)
    const { jsonExporter } = await import("@/lib/exporters/json-exporter")
    jsonExporter.exportSession(fullSession, t, { fileName })
  }

  const exportSessionAsPdf = async (
    session: ChatSession,
    fileName?: string
  ) => {
    const fullSession = await getFullSession(session)
    const { pdfExporter } = await import("@/lib/exporters/pdf-exporter")
    pdfExporter.exportSession(fullSession, t, { fileName })
  }

  const exportSessionAsMarkdown = async (
    session: ChatSession,
    fileName?: string
  ) => {
    const fullSession = await getFullSession(session)
    const { markdownExporter } = await import(
      "@/lib/exporters/markdown-exporter"
    )
    markdownExporter.exportSession(fullSession, t, { fileName })
  }

  const exportSessionAsText = async (
    session: ChatSession,
    fileName?: string
  ) => {
    const fullSession = await getFullSession(session)
    const { textExporter } = await import("@/lib/exporters/text-exporter")
    textExporter.exportSession(fullSession, t, { fileName })
  }

  return {
    exportSessionAsJson,
    exportSessionAsPdf,
    exportSessionAsMarkdown,
    exportSessionAsText
  }
}
