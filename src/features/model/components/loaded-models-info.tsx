"use client"

import { useEffect, useState } from "react"

import { Brain, ChevronDown, Loader2, RefreshCw, Trash } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from "@/components/ui/collapsible"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from "@/components/ui/tooltip"
import { MESSAGE_KEYS } from "@/lib/constants"

interface LoadedModel {
  name: string
  model: string
  size: number
  digest: string
  details: {
    parent_model: string
    format: string
    family: string
    families: string[]
    parameter_size: string
    quantization_level: string
  }
  expires_at: string
  size_vram: number
}

const formatBytes = (bytes: number): string => {
  if (bytes === 0) return "0 B"
  const k = 1024
  const sizes = ["B", "KB", "MB", "GB"]
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i]
}

export default function LoadedModelsInfo() {
  const [models, setModels] = useState<LoadedModel[]>([])
  const [loading, setLoading] = useState(false)
  const [unloading, setUnloading] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [isExpanded, setIsExpanded] = useState(false)

  const fetchModels = async (isRefresh = false) => {
    if (isRefresh) {
      setRefreshing(true)
    } else {
      setLoading(true)
    }

    chrome.runtime.sendMessage(
      { type: MESSAGE_KEYS.OLLAMA.GET_LOADED_MODELS },
      (res) => {
        if (res?.success && res.data?.models) {
          setModels(res.data.models)
        } else {
          console.error(res?.error)
          setModels([])
        }
        setLoading(false)
        setRefreshing(false)
      }
    )
  }

  const unloadModel = (modelName: string) => {
    setUnloading(modelName)

    chrome.runtime.sendMessage(
      { type: MESSAGE_KEYS.OLLAMA.UNLOAD_MODEL, payload: modelName },
      (res) => {
        if (res?.success) {
          setModels((prev) => prev.filter((m) => m.name !== modelName))
        } else {
          console.error("Unload error", res?.error)
        }
        setUnloading(null)
      }
    )
  }

  const handleRefresh = () => {
    fetchModels(true)
  }

  const toggleExpanded = () => {
    setIsExpanded(!isExpanded)
  }

  useEffect(() => {
    fetchModels()
    const interval = setInterval(() => fetchModels(), 10000)
    return () => clearInterval(interval)
  }, [])

  const totalSize = models.reduce((acc, model) => acc + model.size, 0)

  return (
    <Card className="w-full rounded-lg border-border bg-card text-card-foreground shadow-sm">
      <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
        <CollapsibleTrigger asChild>
          <div className="flex cursor-pointer items-center justify-between p-2 transition-colors hover:bg-muted/20">
            <div className="flex items-center gap-2">
              <Brain className="h-4 w-4 text-primary" />
              <h3 className="text-lg font-semibold">Models Loaded in Memory</h3>
              {loading && (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              )}
            </div>

            <div className="flex items-center gap-2">
              {models.length > 0 && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <span>
                    {models.length} model{models.length !== 1 ? "s" : ""}
                  </span>
                  <span>•</span>
                  <span>{formatBytes(totalSize)}</span>
                </div>
              )}

              <div className="flex items-center gap-1">
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
                    <p>Refresh models</p>
                  </TooltipContent>
                </Tooltip>

                <ChevronDown
                  className={`h-4 w-4 transition-transform duration-200 ${
                    isExpanded ? "rotate-180" : ""
                  }`}
                />
              </div>
            </div>
          </div>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="border-t border-border px-4 pb-4">
            {models.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-6 text-center">
                <Brain className="mb-2 h-8 w-8 text-muted-foreground/50" />
                <p className="text-sm text-muted-foreground">
                  No models currently loaded in memory
                </p>
                <p className="mt-1 text-xs text-muted-foreground/70">
                  Models will appear here when loaded
                </p>
              </div>
            ) : (
              <div className="flex flex-wrap gap-3 pt-4">
                {models.map((model) => (
                  <div
                    key={model.name}
                    className="group flex items-center gap-3 rounded-lg border border-border bg-muted/50 px-4 py-3 transition-colors hover:bg-muted">
                    <div className="flex flex-col gap-1.5">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">
                          {model.name}
                        </span>
                        <Badge
                          variant="outline"
                          className="h-5 font-mono text-xs">
                          {model.details.family}
                        </Badge>
                      </div>

                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Badge variant="secondary" className="h-4 text-xs">
                          {formatBytes(model.size)}
                        </Badge>
                        <span>•</span>
                        <span className="font-mono">
                          {model.details.parameter_size}
                        </span>
                        <span>•</span>
                        <span className="font-mono">
                          {model.details.quantization_level}
                        </span>
                      </div>
                    </div>

                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 w-8 p-0 opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                          onClick={() => unloadModel(model.name)}
                          disabled={unloading === model.name}>
                          {unloading === model.name ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Trash className="h-4 w-4" />
                          )}
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>Unload {model.name}</p>
                      </TooltipContent>
                    </Tooltip>
                  </div>
                ))}
              </div>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  )
}
