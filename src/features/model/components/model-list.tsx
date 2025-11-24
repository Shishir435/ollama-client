import { useState } from "react"
import { useTranslation } from "react-i18next"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from "@/components/ui/tooltip"
import { useOllamaModels } from "@/features/model/hooks/use-ollama-models"
import {
  Calendar,
  ChevronDown,
  ChevronUp,
  Database,
  HardDrive,
  RefreshCw,
  Trash2
} from "@/lib/lucide-icon"
import type { OllamaModel } from "@/types"

const formatFileSize = (
  bytes: number | string,
  t: (key: string) => string
): string => {
  if (!bytes) return t("settings.model_list.unknown_size")

  const units = ["B", "KB", "MB", "GB", "TB"]
  let size = typeof bytes === "string" ? parseInt(bytes, 10) : bytes
  let unitIndex = 0

  if (Number.isNaN(size)) return t("settings.model_list.invalid_size")

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex++
  }

  return `${size.toFixed(unitIndex > 0 ? 1 : 0)} ${units[unitIndex]}`
}

const formatDate = (
  dateString: string,
  t: (key: string, options?: Record<string, unknown>) => string
): string => {
  if (!dateString) return t("settings.model_list.unknown_date")

  try {
    const date = new Date(dateString)
    const now = new Date()
    const diffInHours = (now.getTime() - date.getTime()) / (1000 * 60 * 60)

    if (diffInHours < 24) {
      return t("settings.model_list.time_ago_hours", {
        count: Math.floor(diffInHours)
      })
    } else if (diffInHours < 24 * 7) {
      return t("settings.model_list.time_ago_days", {
        count: Math.floor(diffInHours / 24)
      })
    } else {
      return date.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: date.getFullYear() !== now.getFullYear() ? "numeric" : undefined
      })
    }
  } catch (_error) {
    return t("settings.model_list.invalid_date")
  }
}

const getModelIcon = (modelName: string): string => {
  const name = modelName.toLowerCase()
  if (name.includes("llama")) return "🦙"
  if (name.includes("mistral")) return "🌪️"
  if (name.includes("codellama")) return "💻"
  if (name.includes("phi")) return "📐"
  if (name.includes("gemma")) return "💎"
  return "🤖"
}

export const ModelList = (): JSX.Element => {
  const { t } = useTranslation()
  const { models, loading, error, deleteModel, refresh } = useOllamaModels()
  const [isOpen, setIsOpen] = useState<boolean>(false)
  const [refreshing, setRefreshing] = useState(false)

  const handleRefresh = () => {
    setRefreshing(true)
    refresh()
    setRefreshing(false)
  }

  if (loading) {
    return (
      <div className="rounded-lg border bg-card">
        <div className="flex items-center justify-between border-b p-3">
          <div className="flex items-center gap-2">
            <Skeleton className="h-4 w-4" />
            <Skeleton className="h-5 w-24" />
          </div>
          <Skeleton className="h-4 w-4" />
        </div>
        <div className="space-y-2 p-3">
          {[...Array(3)].map((_, i) => (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: Skeleton items don't need unique keys
              key={`skeleton-${i}`}
              className="flex items-center gap-3 p-2">
              <Skeleton className="h-8 w-8 rounded" />
              <div className="flex-1 space-y-1">
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-3 w-1/3" />
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-lg border bg-card">
        <div className="flex items-center justify-between border-b p-3">
          <div className="flex items-center gap-2">
            <Database className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">
              {t("settings.model_list.title")}
            </span>
          </div>
        </div>
        <div className="p-3">
          <div className="mb-2 text-sm text-destructive">{error}</div>
          <Button variant="outline" size="sm" onClick={refresh} className="h-8">
            <RefreshCw className="mr-1 h-3 w-3" />
            {t("settings.model_list.retry")}
          </Button>
        </div>
      </div>
    )
  }

  if (!models || models.length === 0) {
    return (
      <div className="rounded-lg border bg-card">
        <div className="flex items-center justify-between border-b p-3">
          <div className="flex items-center gap-2">
            <Database className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">
              {t("settings.model_list.title")}
            </span>
          </div>
        </div>
        <div className="p-3">
          <div className="mb-2 text-sm text-muted-foreground">
            {t("settings.model_list.no_models")}
          </div>
          <Button variant="outline" size="sm" onClick={refresh} className="h-8">
            <RefreshCw className="mr-1 h-3 w-3" />
            {t("settings.model_list.refresh")}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <Card className="w-full rounded-lg border-border bg-card text-card-foreground shadow-sm">
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <button
          type="button"
          className="flex w-full items-center justify-between p-2 text-left hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => setIsOpen(!isOpen)}>
          <div className="flex items-center gap-2">
            <Database className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">
              {t("settings.model_list.title_count", { count: models.length })}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation()
                    handleRefresh()
                  }}
                  disabled={refreshing}
                  className="h-8 w-8 p-0">
                  <RefreshCw
                    className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`}
                  />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>{t("settings.model_list.refresh_tooltip")}</p>
              </TooltipContent>
            </Tooltip>
            {isOpen ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </div>
        </button>

        <CollapsibleContent>
          <div className="border-t">
            <ScrollArea className="h-64">
              <div className="flex flex-wrap justify-center gap-1 space-y-1 p-2">
                {models.map((model: OllamaModel) => (
                  <Card
                    key={model.name}
                    className="flex-1 cursor-pointer border-0 shadow-none transition-colors hover:bg-muted/50">
                    <CardContent className="p-3">
                      <div className="flex items-center gap-3">
                        <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded bg-muted text-sm">
                          {getModelIcon(model.name)}
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium">
                            {model.name}
                          </div>

                          <div className="mt-1 flex items-center gap-3">
                            <div className="flex items-center gap-1 text-xs text-muted-foreground">
                              <HardDrive className="h-3 w-3" />
                              <span>{formatFileSize(model.size, t)}</span>
                            </div>

                            <div className="flex items-center gap-1 text-xs text-muted-foreground">
                              <Calendar className="h-3 w-3" />
                              <span>{formatDate(model.modified_at, t)}</span>
                            </div>
                          </div>
                        </div>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 text-destructive hover:bg-destructive/10"
                              onClick={(e) => e.stopPropagation()}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>
                                {t("settings.model_list.delete_dialog.title", {
                                  name: model.name
                                })}
                              </AlertDialogTitle>
                              <AlertDialogDescription>
                                {t(
                                  "settings.model_list.delete_dialog.description"
                                )}
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>
                                {t("settings.model_list.delete_dialog.cancel")}
                              </AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => deleteModel(model.name)}
                                className="bg-destructive hover:bg-destructive/90">
                                {t("settings.model_list.delete_dialog.confirm")}
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </ScrollArea>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  )
}
