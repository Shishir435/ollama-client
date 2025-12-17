import { useTranslation } from "react-i18next"
import { jsonExporter } from "@/lib/exporters/json-exporter"
import { markdownExporter } from "@/lib/exporters/markdown-exporter"
import { pdfExporter } from "@/lib/exporters/pdf-exporter"
import { textExporter } from "@/lib/exporters/text-exporter"
import type { ChatMessage } from "@/types"

export const useMessageExport = () => {
  const { t } = useTranslation()

  const exportMessageAsJson = (message: ChatMessage, fileName?: string) => {
    jsonExporter.exportMessage(message, t, { fileName })
  }

  const exportMessageAsPdf = (message: ChatMessage, fileName?: string) => {
    pdfExporter.exportMessage(message, t, { fileName })
  }

  const exportMessageAsMarkdown = (message: ChatMessage, fileName?: string) => {
    markdownExporter.exportMessage(message, t, { fileName })
  }

  const exportMessageAsText = (message: ChatMessage, fileName?: string) => {
    textExporter.exportMessage(message, t, { fileName })
  }

  return {
    exportMessageAsJson,
    exportMessageAsPdf,
    exportMessageAsMarkdown,
    exportMessageAsText
  }
}
