import { useTranslation } from "react-i18next"
import { toast } from "@/hooks/use-toast"
import { logger } from "@/lib/logger"
import type { ChatMessage } from "@/types"

// Exporters pull in heavy deps (markdown-it + highlight.js, jsPDF, jszip).
// Load them on demand so they stay out of the eager side-panel bundle.
export const useMessageExport = () => {
  const { t } = useTranslation()

  // Exporters load lazily, so a chunk-load failure would otherwise be swallowed
  // by the fire-and-forget call sites. Surface it instead of failing silently.
  const guard = async (run: () => Promise<void>) => {
    try {
      await run()
    } catch (error) {
      logger.error("Message export failed", "useMessageExport", { error })
      toast({
        variant: "destructive",
        title: t("settings.migration.export.error_title")
      })
    }
  }

  const exportMessageAsJson = (message: ChatMessage, fileName?: string) =>
    guard(async () => {
      const { jsonExporter } = await import("@/lib/exporters/json-exporter")
      jsonExporter.exportMessage(message, t, { fileName })
    })

  const exportMessageAsPdf = (message: ChatMessage, fileName?: string) =>
    guard(async () => {
      const { pdfExporter } = await import("@/lib/exporters/pdf-exporter")
      await pdfExporter.exportMessage(message, t, { fileName })
    })

  return {
    exportMessageAsJson,
    exportMessageAsPdf
  }
}
