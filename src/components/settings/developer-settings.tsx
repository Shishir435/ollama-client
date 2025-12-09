import { AlertCircle, Code, Download, Eye, Trash2 } from "lucide-react"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { LogViewerDialog } from "@/components/settings/log-viewer-dialog"
import { SettingsCard } from "@/components/settings/settings-card"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { LOG_LEVEL_NAMES, type LogLevel, logger } from "@/lib/logger"

export function DeveloperSettings() {
  const { t } = useTranslation()
  const [logLevel, setLogLevel] = useState<string>(logger.getLogLevelName())
  const [isLogViewerOpen, setIsLogViewerOpen] = useState(false)
  const [bufferSize, setBufferSize] = useState(0)
  const [isIndexedDBEnabled, setIsIndexedDBEnabled] = useState(
    logger.isIndexedDBEnabled()
  )
  const [shouldCrash, setShouldCrash] = useState(false)

  if (shouldCrash) {
    throw new Error(t("settings.developer.manualCrashError"))
  }

  useEffect(() => {
    // Update buffer size periodically
    const interval = setInterval(() => {
      setBufferSize(logger.getBufferSize())
    }, 1000)

    return () => clearInterval(interval)
  }, [])

  const handleLogLevelChange = async (value: string) => {
    setLogLevel(value)

    // Convert string to LogLevel enum
    const level = Object.entries(LOG_LEVEL_NAMES).find(
      ([_, name]) => name === value
    )?.[0]

    if (level !== undefined) {
      await logger.setLogLevel(Number(level) as LogLevel)
    }
  }

  const handleExportLogs = () => {
    const logsJson = logger.exportLogs()
    const blob = new Blob([logsJson], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `ollama-client-logs-${new Date().toISOString()}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)

    logger.info("Logs exported", "DeveloperSettings")
  }

  const handleClearLogs = async () => {
    if (
      confirm(
        t("settings.developer.confirmClear", {
          defaultValue: "Are you sure you want to clear all logs?"
        })
      )
    ) {
      await logger.clearLogs()
      setBufferSize(0)
    }
  }

  return (
    <>
      <SettingsCard
        title={t("settings.developer.title")}
        description={t("settings.developer.description")}
        icon={Code}>
        <div className="space-y-4">
          {/* Log Level Selector */}
          <div className="space-y-2">
            <Label htmlFor="log-level">
              {t("settings.developer.logLevel")}
            </Label>
            <Select value={logLevel} onValueChange={handleLogLevelChange}>
              <SelectTrigger id="log-level">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="error">
                  {t("settings.developer.levels.error")}
                </SelectItem>
                <SelectItem value="warn">
                  {t("settings.developer.levels.warn")}
                </SelectItem>
                <SelectItem value="info">
                  {t("settings.developer.levels.info")}
                </SelectItem>
                <SelectItem value="verbose">
                  {t("settings.developer.levels.verbose")}
                </SelectItem>
                <SelectItem value="debug">
                  {t("settings.developer.levels.debug")}
                </SelectItem>
              </SelectContent>
            </Select>
            <p className="text-sm text-muted-foreground">
              {t("settings.developer.logLevelDescription")}
            </p>
          </div>

          {/* Enable/Disable Logger */}
          <div className="flex items-center justify-between rounded-md border p-3">
            <div className="space-y-0.5">
              <Label htmlFor="logger-enabled">
                {t("settings.developer.enableLogger", {
                  defaultValue: "Enable Logging"
                })}
              </Label>
              <p className="text-sm text-muted-foreground">
                {t("settings.developer.enableLoggerDescription", {
                  defaultValue:
                    "Turn off logging to improve performance if experiencing issues"
                })}
              </p>
            </div>
            <Switch
              id="logger-enabled"
              checked={logger.isEnabled()}
              onCheckedChange={async (checked) => {
                if (checked) {
                  await logger.enable()
                } else {
                  await logger.disable()
                }
              }}
            />
          </div>

          {/* IndexedDB Storage Toggle */}
          <div className="flex items-center justify-between rounded-md border p-3">
            <div className="space-y-0.5">
              <Label htmlFor="logger-indexeddb">
                {t("settings.developer.persistLogs", {
                  defaultValue: "Persist Logs to IndexedDB"
                })}
              </Label>
              <p className="text-sm text-muted-foreground">
                {t("settings.developer.persistLogsDescription", {
                  defaultValue:
                    "Store logs in IndexedDB for persistence across browser restarts (recommended)"
                })}
              </p>
            </div>
            <Switch
              id="logger-indexeddb"
              checked={isIndexedDBEnabled}
              onCheckedChange={async (checked) => {
                if (checked) {
                  await logger.enableIndexedDB()
                } else {
                  await logger.disableIndexedDB()
                }
                setIsIndexedDBEnabled(checked)
              }}
            />
          </div>

          {/* Buffer Info */}
          <div className="rounded-md bg-muted p-3">
            <p className="text-sm">
              {t("settings.developer.bufferSize", {
                current: bufferSize,
                max: logger.getMaxBufferSize()
              })}
            </p>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => setIsLogViewerOpen(true)}
              variant="outline"
              className="flex-1">
              <Eye className="mr-2 h-4 w-4" />
              {t("settings.developer.viewLogs")}
            </Button>

            <Button
              onClick={handleExportLogs}
              variant="outline"
              className="flex-1">
              <Download className="mr-2 h-4 w-4" />
              {t("settings.developer.exportLogs")}
            </Button>

            <Button
              onClick={handleClearLogs}
              variant="destructive"
              className="flex-1">
              <Trash2 className="mr-2 h-4 w-4" />
              {t("settings.developer.clearLogs")}
            </Button>

            <Button
              onClick={() => {
                if (confirm(t("settings.developer.confirmCrash"))) {
                  setShouldCrash(true)
                }
              }}
              variant="destructive"
              className="flex-1">
              <AlertCircle className="mr-2 h-4 w-4" />
              {t("settings.developer.crashApp", "Crash App (Test)")}
            </Button>
          </div>

          <div className="rounded-md border border-blue-200 bg-blue-50 p-3 dark:border-blue-900 dark:bg-blue-950">
            <h4 className="mb-1 text-sm font-medium text-blue-900 dark:text-blue-100">
              {t("settings.developer.troubleshooting.title")}
            </h4>
            <p className="text-sm text-blue-700 dark:text-blue-300">
              {t("settings.developer.troubleshooting.description")}
            </p>
          </div>
        </div>
      </SettingsCard>

      <LogViewerDialog
        open={isLogViewerOpen}
        onClose={() => setIsLogViewerOpen(false)}
      />
    </>
  )
}
