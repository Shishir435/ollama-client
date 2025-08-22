import { useState } from "react"

import {
  Calendar,
  ChevronDown,
  ChevronUp,
  Database,
  HardDrive,
  RefreshCw,
  Trash2
} from "lucide-react"

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
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from "@/components/ui/collapsible"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from "@/components/ui/tooltip"
import { useOllamaModels } from "@/features/model/hooks/use-ollama-models"
import type { OllamaModel } from "@/types"

const formatFileSize = (bytes: number | string): string => {
  if (!bytes) return "Unknown size"

  const units = ["B", "KB", "MB", "GB", "TB"]
  let size = typeof bytes === "string" ? parseInt(bytes, 10) : bytes
  let unitIndex = 0

  if (isNaN(size)) return "Invalid size"

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex++
  }

  return `${size.toFixed(unitIndex > 0 ? 1 : 0)} ${units[unitIndex]}`
}

const formatDate = (dateString: string): string => {
  if (!dateString) return "Unknown date"

  try {
    const date = new Date(dateString)
    const now = new Date()
    const diffInHours = (now.getTime() - date.getTime()) / (1000 * 60 * 60)

    if (diffInHours < 24) {
      return `${Math.floor(diffInHours)}h ago`
    } else if (diffInHours < 24 * 7) {
      return `${Math.floor(diffInHours / 24)}d ago`
    } else {
      return date.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: date.getFullYear() !== now.getFullYear() ? "numeric" : undefined
      })
    }
  } catch (error) {
    return "Invalid date"
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
            <div key={i} className="flex items-center gap-3 p-2">
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
            <Database className="h-4 w-4" />
            <span className="text-sm font-medium">Models</span>
          </div>
        </div>
        <div className="p-3">
          <div className="mb-2 text-sm text-destructive">{error}</div>
          <Button variant="outline" size="sm" onClick={refresh} className="h-8">
            <RefreshCw className="mr-1 h-3 w-3" />
            Retry
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
            <Database className="h-4 w-4" />
            <span className="text-sm font-medium">Models</span>
          </div>
        </div>
        <div className="p-3">
          <div className="mb-2 text-sm text-muted-foreground">
            No models found
          </div>
          <Button variant="outline" size="sm" onClick={refresh} className="h-8">
            <RefreshCw className="mr-1 h-3 w-3" />
            Refresh
          </Button>
        </div>
      </div>
    )
  }

  return (
    <Card className="w-full rounded-lg border-border bg-card text-card-foreground shadow-sm">
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CollapsibleTrigger asChild>
          <Button
            variant="ghost"
            className="h-auto w-full justify-between p-2 hover:bg-muted/50">
            <div className="flex items-center gap-2">
              <Database className="h-4 w-4" />
              <span className="text-sm font-medium">
                Models ({models.length})
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
                  <p>Refresh model</p>
                </TooltipContent>
              </Tooltip>
              {isOpen ? (
                <ChevronUp className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
            </div>
          </Button>
        </CollapsibleTrigger>

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
                              <span>{formatFileSize(model.size)}</span>
                            </div>

                            <div className="flex items-center gap-1 text-xs text-muted-foreground">
                              <Calendar className="h-3 w-3" />
                              <span>{formatDate(model.modified_at)}</span>
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
                                Delete model "{model.name}"?
                              </AlertDialogTitle>
                              <AlertDialogDescription>
                                This action cannot be undone. The model will be
                                permanently removed from your local system.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => deleteModel(model.name)}
                                className="bg-destructive hover:bg-destructive/90">
                                Delete
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
