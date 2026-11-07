import { useTranslation } from "react-i18next"
import { hydrateMessageImages } from "@/features/sessions/lib/image-bytes"
import { toast } from "@/hooks/use-toast"
import { logger } from "@/lib/logger"
import type { ChatMessage } from "@/types"

/**
 * Lazy message-export actions. Export implementations carry heavy formatting
 * and archive dependencies, so importers get callbacks without adding those
 * modules to the eager side-panel bundle.
 */
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
      const [full] = await hydrateMessageImages([message])
      jsonExporter.exportMessage(full, t, { fileName })
    })

  const exportMessageAsPdf = (message: ChatMessage, fileName?: string) =>
    guard(async () => {
      const { pdfExporter } = await import("@/lib/exporters/pdf-exporter")
      const [full] = await hydrateMessageImages([message])
      await pdfExporter.exportMessage(full, t, { fileName })
    })

  return {
    exportMessageAsJson,
    exportMessageAsPdf
  }
}
