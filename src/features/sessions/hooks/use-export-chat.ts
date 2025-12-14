import { useTranslation } from "react-i18next"

import { jsonExporter } from "@/lib/exporters/json-exporter"
import { markdownExporter } from "@/lib/exporters/markdown-exporter"
import { pdfExporter } from "@/lib/exporters/pdf-exporter"
import { textExporter } from "@/lib/exporters/text-exporter"
import type { ChatSession } from "@/types"

export const useChatExport = () => {
  const { t } = useTranslation()

  const exportSessionAsJson = (session: ChatSession, fileName?: string) => {
    jsonExporter.exportSession(session, t, { fileName })
  }

  const exportAllSessionsAsJson = (sessions: ChatSession[]) => {
    jsonExporter.exportAllSessions(sessions, t)
  }

  const exportSessionAsPdf = (session: ChatSession, fileName?: string) => {
    pdfExporter.exportSession(session, t, { fileName })
  }

  const exportAllSessionsAsPdf = (sessions: ChatSession[]) => {
    pdfExporter.exportAllSessions(sessions, t)
  }

  const exportSessionAsMarkdown = (session: ChatSession, fileName?: string) => {
    markdownExporter.exportSession(session, t, { fileName })
  }

  const exportAllSessionsAsMarkdown = (sessions: ChatSession[]) => {
    markdownExporter.exportAllSessions(sessions, t)
  }

  const exportSessionAsText = (session: ChatSession, fileName?: string) => {
    textExporter.exportSession(session, t, { fileName })
  }

  const exportAllSessionsAsText = (sessions: ChatSession[]) => {
    textExporter.exportAllSessions(sessions, t)
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
