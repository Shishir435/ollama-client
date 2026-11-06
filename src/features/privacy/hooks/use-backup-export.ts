import { useCallback, useState } from "react"
import { useTranslation } from "react-i18next"
import { useToast } from "@/hooks/use-toast"
import { getDisplayErrorMessage } from "@/lib/error-display"
import { formatBackupFilenameTimestamp } from "@/lib/format-utils"
import { logger } from "@/lib/logger"

/**
 * Downloads a full backup archive. Returns whether the file was handed to the
 * browser, so a destructive flow can offer "back up first" and know it worked.
 */
export const useBackupExport = () => {
  const { t } = useTranslation()
  const { toast } = useToast()
  const [exporting, setExporting] = useState(false)

  const exportBackup = useCallback(async (): Promise<boolean> => {
    setExporting(true)
    try {
      const { backupService } = await import("@/lib/backup-service")
      const blob = await backupService.exportAll()
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement("a")
      anchor.href = url
      anchor.download = `ollama-client-backup-${formatBackupFilenameTimestamp()}.zip`
      document.body.appendChild(anchor)
      anchor.click()
      document.body.removeChild(anchor)
      URL.revokeObjectURL(url)
      toast({ title: t("settings.migration.export.success_title") })
      return true
    } catch (error: unknown) {
      toast({
        title: t("settings.migration.export.error_title"),
        description: getDisplayErrorMessage(
          error,
          t("settings.migration.unknown_error")
        ),
        variant: "destructive"
      })
      logger.error("Backup export failed", "useBackupExport", { error })
      return false
    } finally {
      setExporting(false)
    }
  }, [t, toast])

  return { exporting, exportBackup }
}
