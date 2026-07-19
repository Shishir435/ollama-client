import { useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { browser } from "wxt/browser"
import {
  ConfirmActionDialog,
  SettingsCard,
  SettingsFormField
} from "@/components/settings"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useConfirmAction } from "@/hooks/use-confirm-action"
import { useToast } from "@/hooks/use-toast"
import { backupService, type ImportResult } from "@/lib/backup-service"
import { getDisplayErrorMessage } from "@/lib/error-display"
import { formatBackupFilenameTimestamp } from "@/lib/format-utils"
import { logger } from "@/lib/logger"
import {
  CheckCircle,
  Download,
  HardDriveDownload,
  Loader2,
  Upload,
  XCircle
} from "@/lib/lucide-icon"

export const DataMigrationSettings = () => {
  const { t } = useTranslation()
  const { toast } = useToast()
  const [isExporting, setIsExporting] = useState(false)
  const [isImporting, setIsImporting] = useState(false)

  const importConfirmDialog = useConfirmAction()
  const resultDialog = useConfirmAction()
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [importResult, setImportResult] = useState<ImportResult | null>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleExport = async () => {
    try {
      setIsExporting(true)
      const blob = await backupService.exportAll()
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `ollama-client-backup-${formatBackupFilenameTimestamp()}.zip`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (error: unknown) {
      const errorMessage = getDisplayErrorMessage(error, "Unknown error")
      toast({
        title: t("settings.migration.export.error_title"),
        description: errorMessage,
        variant: "destructive"
      })
      logger.error("Export failed", "DataMigrationSettings", { error })
    } finally {
      setIsExporting(false)
    }
  }

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      setSelectedFile(file)
      importConfirmDialog.openDialog()
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = ""
    }
  }

  const confirmImport = async () => {
    if (!selectedFile) return

    importConfirmDialog.closeDialog()
    setIsImporting(true)

    try {
      const result = await backupService.importAll(selectedFile)
      setImportResult(result)
      resultDialog.openDialog()
    } catch (error: unknown) {
      logger.error("Import failed", "DataMigrationSettings", { error })
      setImportResult({
        syncStorage: {
          ok: false,
          error: getDisplayErrorMessage(error, "Unknown error")
        },
        localStorage: {
          ok: false,
          error: t("settings.migration.import_result.status.aborted")
        },
        database: {
          ok: false,
          error: t("settings.migration.import_result.status.aborted")
        },
        dexie: {
          vectorDb: {
            ok: false,
            error: t("settings.migration.import_result.status.aborted")
          },
          knowledgeDb: {
            ok: false,
            error: t("settings.migration.import_result.status.aborted")
          }
        },
        skippedStorageKeys: []
      })
      resultDialog.openDialog()
    } finally {
      setIsImporting(false)
      setSelectedFile(null)
    }
  }

  const closeResultDialogAndReload = () => {
    resultDialog.closeDialog()
    // Auto-reload when the SQLite chat-history database was restored.
    // Vector/knowledge DB failures are non-fatal for the reload decision.
    const restoredChatHistory = importResult?.database.ok
    if (restoredChatHistory) {
      // Restart the whole extension: service worker and every page. The
      // import bumped the SQLite import generation, so any context that
      // keeps running with the old generation (background worker, an open
      // sidepanel) has all of its chat saves silently skipped by the
      // stale-writer guard. A page-level reload fan-out cannot guarantee
      // delivery — runtime.reload() can.
      try {
        browser.runtime.reload()
      } catch {
        window.location.reload()
      }
    }
  }

  return (
    <SettingsCard
      icon={HardDriveDownload}
      title={t("settings.migration.title")}
      description={t("settings.migration.description")}>
      <div className="space-y-4">
        <SettingsFormField
          focusId="data-migration-export"
          label={t("settings.migration.export.label")}
          description={t("settings.migration.export.description")}>
          <Button
            onClick={handleExport}
            disabled={isExporting}
            className="w-full sm:w-auto">
            {isExporting ? (
              <Loader2 className="mr-2 icon-md animate-spin" />
            ) : (
              <Download className="mr-2 icon-md" />
            )}
            {t("settings.migration.export.button")}
          </Button>
        </SettingsFormField>

        <SettingsFormField
          focusId="data-migration-import"
          label={t("settings.migration.import.label")}
          description={t("settings.migration.import.description")}>
          <Button
            onClick={() => fileInputRef.current?.click()}
            disabled={isImporting}
            variant="secondary"
            className="w-full sm:w-auto">
            {isImporting ? (
              <Loader2 className="mr-2 icon-md animate-spin" />
            ) : (
              <Upload className="mr-2 icon-md" />
            )}
            {t("settings.migration.import.button")}
          </Button>
          <input
            type="file"
            ref={fileInputRef}
            className="hidden"
            accept=".zip"
            onChange={onFileChange}
          />
        </SettingsFormField>
      </div>

      <ConfirmActionDialog
        open={importConfirmDialog.open}
        onOpenChange={importConfirmDialog.onOpenChange}
        title={t("settings.migration.import_confirm.title")}
        description={t("settings.migration.import_confirm.description")}
        destructive
        busy={isImporting}
        onConfirm={confirmImport}
      />

      <AlertDialog
        open={resultDialog.open}
        onOpenChange={(open) => {
          if (!open) closeResultDialogAndReload()
        }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("settings.migration.import_result.title")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("settings.migration.import_result.description")}
            </AlertDialogDescription>
            {importResult && importResult.skippedStorageKeys.length > 0 && (
              <p className="text-sm text-muted-foreground">
                {t("settings.migration.import_result.skipped_private")}
              </p>
            )}
          </AlertDialogHeader>

          <div className="py-4 space-y-4">
            {importResult &&
              [
                {
                  label: t("settings.migration.import_result.labels.sync"),
                  result: importResult.syncStorage
                },
                {
                  label: t("settings.migration.import_result.labels.local"),
                  result: importResult.localStorage
                },
                {
                  label: t("settings.migration.import_result.labels.database"),
                  result: importResult.database
                },
                {
                  label: t("settings.migration.import_result.labels.vectorDb"),
                  result: importResult.dexie.vectorDb
                },
                {
                  label: t(
                    "settings.migration.import_result.labels.knowledgeDb"
                  ),
                  result: importResult.dexie.knowledgeDb
                }
              ].map((item) => (
                <div
                  key={item.label}
                  className="flex flex-col gap-1 border-b pb-2 last:border-0 last:pb-0">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-sm">{item.label}</span>
                    <Badge
                      variant={item.result.ok ? "default" : "destructive"}
                      className="gap-1">
                      {item.result.ok ? (
                        <CheckCircle className="icon-xs" />
                      ) : (
                        <XCircle className="icon-xs" />
                      )}
                      {item.result.ok
                        ? t("settings.migration.import_result.status.success")
                        : t("settings.migration.import_result.status.failed")}
                    </Badge>
                  </div>
                  {!item.result.ok && item.result.error && (
                    <p className="text-xs text-destructive mt-1">
                      {item.result.error}
                    </p>
                  )}
                </div>
              ))}
          </div>

          <AlertDialogFooter>
            <AlertDialogAction onClick={closeResultDialogAndReload}>
              {importResult?.database.ok
                ? t("common.reload")
                : t("common.close")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SettingsCard>
  )
}
