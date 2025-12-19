import { Search, X } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select"
import { LOG_LEVEL_NAMES, type LogEntry, LogLevel, logger } from "@/lib/logger"

interface LogViewerDialogProps {
  open: boolean
  onClose: () => void
}

export function LogViewerDialog({ open, onClose }: LogViewerDialogProps) {
  const { t } = useTranslation()
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [filterLevel, setFilterLevel] = useState<string>("all")
  const [searchQuery, setSearchQuery] = useState("")

  useEffect(() => {
    if (open) {
      // Load logs when dialog opens
      const loadLogs = async () => {
        const allLogs = await logger.getLogs()
        console.log("[LogViewerDialog] Loading logs:", {
          totalLogs: allLogs.length,
          bufferSize: logger.getBufferSize(),
          logLevel: logger.getLogLevelName()
        })
        setLogs(allLogs)
      }
      loadLogs()
    }
  }, [open])

  const filteredLogs = useMemo(() => {
    let filtered = [...logs]

    // Filter by log level
    if (filterLevel !== "all") {
      const level = Object.entries(LOG_LEVEL_NAMES).find(
        ([_, name]) => name === filterLevel
      )?.[0]
      if (level !== undefined) {
        filtered = filtered.filter((log) => log.level >= Number(level))
      }
    }

    // Filter by search query
    if (searchQuery) {
      const query = searchQuery.toLowerCase()
      filtered = filtered.filter(
        (log) =>
          log.message.toLowerCase().includes(query) ||
          log.context?.toLowerCase().includes(query)
      )
    }

    return filtered
  }, [logs, filterLevel, searchQuery])

  const getLevelBadgeVariant = (
    level: LogLevel
  ): "default" | "destructive" | "outline" | "secondary" => {
    switch (level) {
      case LogLevel.ERROR:
        return "destructive"
      case LogLevel.WARN:
        return "default"
      case LogLevel.INFO:
        return "secondary"
      case LogLevel.VERBOSE:
      case LogLevel.DEBUG:
        return "outline"
    }
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-h-[85vh] max-w-5xl">
        <DialogHeader>
          <DialogTitle>{t("settings.developer.logViewer.title")}</DialogTitle>
          <DialogDescription>
            {t("settings.developer.logViewer.description", {
              count: filteredLogs.length,
              total: logs.length
            })}
          </DialogDescription>
        </DialogHeader>

        {/* Filters */}
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder={t("settings.developer.logViewer.search")}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8"
            />
            {searchQuery && (
              <Button
                variant="ghost"
                size="sm"
                className="absolute right-1 top-1 h-7 w-7 p-0"
                onClick={() => setSearchQuery("")}>
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>

          <Select value={filterLevel} onValueChange={setFilterLevel}>
            <SelectTrigger className="w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">
                {t("settings.developer.logViewer.allLevels")}
              </SelectItem>
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
        </div>

        {/* Log List */}
        <ScrollArea className="h-[500px] rounded-md border">
          {filteredLogs.length === 0 ? (
            <div className="flex h-[200px] items-center justify-center text-muted-foreground">
              {t("settings.developer.logViewer.noLogs")}
            </div>
          ) : (
            <div className="space-y-2 p-4">
              {filteredLogs.map((log, idx) => (
                <div
                  key={`${log.timestamp}-${idx}`}
                  className="rounded-lg border bg-card p-3 text-sm hover:bg-accent/50">
                  <div className="mb-2 flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Badge variant={getLevelBadgeVariant(log.level)}>
                        {LOG_LEVEL_NAMES[log.level].toUpperCase()}
                      </Badge>
                      {log.context && (
                        <code className="rounded bg-muted px-2 py-0.5 text-xs">
                          {log.context}
                        </code>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {new Date(log.timestamp).toLocaleTimeString()}
                    </span>
                  </div>

                  <p className="mb-1 font-medium">{log.message}</p>

                  {log.data && (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
                        {t("settings.developer.logViewer.showData")}
                      </summary>
                      <pre className="mt-2 overflow-x-auto rounded bg-muted p-2 text-xs">
                        {JSON.stringify(log.data, null, 2)}
                      </pre>
                    </details>
                  )}
                </div>
              ))}
            </div>
          )}
        </ScrollArea>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            {t("settings.developer.logViewer.close")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
