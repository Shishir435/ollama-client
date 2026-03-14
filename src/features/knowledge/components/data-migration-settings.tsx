import { useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { SettingsCard, SettingsFormField } from "@/components/settings"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { backupService, type ImportResult } from "@/lib/backup-service"
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
  const [isExporting, setIsExporting] = useState(false)
  const [isImporting, setIsImporting] = useState(false)

  const [importConfirmOpen, setImportConfirmOpen] = useState(false)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)

  const [importResult, setImportResult] = useState<ImportResult | null>(null)
  const [resultDialogOpen, setResultDialogOpen] = useState(false)

  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleExport = async () => {
    try {
      setIsExporting(true)
      const blob = await backupService.exportAll()
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
      a.download = `ollama-client-backup-${timestamp}.zip`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (error) {
      console.error("Export failed:", error)
    } finally {
      setIsExporting(false)
    }
  }

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      setSelectedFile(file)
      setImportConfirmOpen(true)
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = ""
    }
  }

  const confirmImport = async () => {
    if (!selectedFile) return

    setImportConfirmOpen(false)
    setIsImporting(true)

    try {
      const result = await backupService.importAll(selectedFile)
      setImportResult(result)
      setResultDialogOpen(true)
    } catch (error) {
      console.error("Import failed:", error)
      setImportResult({
        syncStorage: {
          ok: false,
          error: error instanceof Error ? error.message : "Unknown error"
        },
        localStorage: { ok: false, error: "Aborted" },
        database: { ok: false, error: "Aborted" },
        dexie: {
          chatDb: { ok: false, error: "Aborted" },
          vectorDb: { ok: false, error: "Aborted" },
          knowledgeDb: { ok: false, error: "Aborted" }
        }
      })
      setResultDialogOpen(true)
    } finally {
      setIsImporting(false)
      setSelectedFile(null)
    }
  }

  const closeResultDialogAndReload = () => {
    setResultDialogOpen(false)
    if (
      importResult?.syncStorage.ok &&
      importResult?.localStorage.ok &&
      importResult?.database.ok &&
      importResult?.dexie.chatDb.ok &&
      importResult?.dexie.vectorDb.ok &&
      importResult?.dexie.knowledgeDb.ok
    ) {
      window.location.reload()
    }
  }

  return (
    <SettingsCard
      icon={HardDriveDownload}
      title={t("settings.migration.title")}
      description={t("settings.migration.description")}>
      <div className="space-y-4">
        <SettingsFormField
          label={t("settings.migration.export.label")}
          description={t("settings.migration.export.description")}>
          <Button
            onClick={handleExport}
            disabled={isExporting}
            className="w-full sm:w-auto">
            {isExporting ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Download className="mr-2 h-4 w-4" />
            )}
            {t("settings.migration.export.button")}
          </Button>
        </SettingsFormField>

        <SettingsFormField
          label={t("settings.migration.import.label")}
          description={t("settings.migration.import.description")}>
          <Button
            onClick={() => fileInputRef.current?.click()}
            disabled={isImporting}
            variant="secondary"
            className="w-full sm:w-auto">
            {isImporting ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Upload className="mr-2 h-4 w-4" />
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

      <AlertDialog open={importConfirmOpen} onOpenChange={setImportConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("settings.migration.import_confirm.title")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("settings.migration.import_confirm.description")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isImporting}>
              {t("common.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={confirmImport}
              disabled={isImporting}>
              {t("common.continue")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={resultDialogOpen}
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
          </AlertDialogHeader>

          <div className="py-4 space-y-4">
            {importResult &&
              [
                {
                  label: "Preferences (Sync)",
                  result: importResult.syncStorage
                },
                { label: "Local Storage", result: importResult.localStorage },
                { label: "Database (SQLite)", result: importResult.database },
                {
                  label: "Chat History (Dexie)",
                  result: importResult.dexie.chatDb
                },
                {
                  label: "Vector Embeddings (Dexie)",
                  result: importResult.dexie.vectorDb
                },
                {
                  label: "Knowledge Sets (Dexie)",
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
                        <CheckCircle className="h-3 w-3" />
                      ) : (
                        <XCircle className="h-3 w-3" />
                      )}
                      {item.result.ok ? "Success" : "Failed"}
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
              {importResult?.syncStorage.ok &&
              importResult?.localStorage.ok &&
              importResult?.database.ok &&
              importResult?.dexie.chatDb.ok &&
              importResult?.dexie.vectorDb.ok &&
              importResult?.dexie.knowledgeDb.ok
                ? t("common.reload")
                : t("common.close")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SettingsCard>
  )
}
