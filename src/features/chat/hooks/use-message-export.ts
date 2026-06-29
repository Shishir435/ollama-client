import { useTranslation } from "react-i18next"
import type { ChatMessage } from "@/types"

// Exporters pull in heavy deps (markdown-it + highlight.js, jsPDF, jszip).
// Load them on demand so they stay out of the eager side-panel bundle.
export const useMessageExport = () => {
  const { t } = useTranslation()

  const exportMessageAsJson = async (
    message: ChatMessage,
    fileName?: string
  ) => {
    const { jsonExporter } = await import("@/lib/exporters/json-exporter")
    jsonExporter.exportMessage(message, t, { fileName })
  }

  const exportMessageAsPdf = async (
    message: ChatMessage,
    fileName?: string
  ) => {
    const { pdfExporter } = await import("@/lib/exporters/pdf-exporter")
    pdfExporter.exportMessage(message, t, { fileName })
  }

  const exportMessageAsMarkdown = async (
    message: ChatMessage,
    fileName?: string
  ) => {
    const { markdownExporter } = await import(
      "@/lib/exporters/markdown-exporter"
    )
    markdownExporter.exportMessage(message, t, { fileName })
  }

  const exportMessageAsText = async (
    message: ChatMessage,
    fileName?: string
  ) => {
    const { textExporter } = await import("@/lib/exporters/text-exporter")
    textExporter.exportMessage(message, t, { fileName })
  }

  return {
    exportMessageAsJson,
    exportMessageAsPdf,
    exportMessageAsMarkdown,
    exportMessageAsText
  }
}
