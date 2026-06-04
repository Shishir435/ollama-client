import { useCallback, useEffect, useState } from "react"
import { useTranslation } from "react-i18next"

import { TooltipActionButton } from "@/components/actions"
import { Badge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from "@/components/ui/collapsible"
import { useProviderModels } from "@/features/model/hooks/use-provider-models"
import { browser } from "@/lib/browser-api"
import { MESSAGE_KEYS } from "@/lib/constants"
import { logger } from "@/lib/logger"
import {
  Brain,
  ChevronDown,
  Loader2,
  RefreshCw,
  Trash
} from "@/lib/lucide-icon"
import { cn } from "@/lib/utils"
import type { ChromeResponse } from "@/types"

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
  return `${parseFloat((bytes / k ** i).toFixed(1))} ${sizes[i]}`
}

export const LoadedModelsInfo = () => {
  const { t } = useTranslation()
  const { selectedProviderCapabilities, selectedProviderId } =
    useProviderModels()
  const [models, setModels] = useState<LoadedModel[]>([])
  const [loading, setLoading] = useState(false)
  const [unloading, setUnloading] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [isExpanded, setIsExpanded] = useState(false)

  const fetchModels = useCallback(
    async (isRefresh = false) => {
      if (isRefresh) {
        setRefreshing(true)
      } else {
        setLoading(true)
      }

      try {
        const res = (await browser.runtime.sendMessage({
          type: MESSAGE_KEYS.PROVIDER.GET_LOADED_MODELS,
          payload: {
            providerId: selectedProviderId
          }
        })) as ChromeResponse & {
          data?: { models?: LoadedModel[] }
        }
        if (res?.success && res.data?.models) {
          setModels(res.data.models)
        } else {
          logger.error("Failed to fetch loaded models", "LoadedModelsInfo", {
            error: res?.error
          })
          setModels([])
        }
      } catch (error) {
        logger.error("Failed to fetch loaded models", "LoadedModelsInfo", {
          error
        })
        setModels([])
      } finally {
        setLoading(false)
        setRefreshing(false)
      }
    },
    [selectedProviderId]
  )

  const unloadModel = async (modelName: string) => {
    setUnloading(modelName)
    try {
      const res = (await browser.runtime.sendMessage({
        type: MESSAGE_KEYS.PROVIDER.UNLOAD_MODEL,
        payload: {
          model: modelName,
          providerId: selectedProviderId
        }
      })) as ChromeResponse
      if (res?.success) {
        setModels((prev) => prev.filter((m) => m.name !== modelName))
      } else {
        logger.error("Unload error", "LoadedModelsInfo", { error: res?.error })
      }
    } catch (error) {
      logger.error("Failed to unload model", "LoadedModelsInfo", { error })
    } finally {
      setUnloading(null)
    }
  }

  const handleRefresh = () => {
    fetchModels(true)
  }

  useEffect(() => {
    if (!selectedProviderCapabilities?.modelUnload) return
    fetchModels()
    const interval = setInterval(() => fetchModels(), 10000)
    return () => clearInterval(interval)
  }, [fetchModels, selectedProviderCapabilities?.modelUnload])

  if (!selectedProviderCapabilities?.modelUnload) {
    return null
  }

  const totalSize = models.reduce((acc, model) => acc + model.size, 0)

  return (
    <Card className="w-full py-0">
      <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
        <CollapsibleTrigger
          render={
            <div className="flex cursor-pointer items-center justify-between p-2 transition-colors hover:bg-muted/20" />
          }>
          <div className="flex items-center gap-2">
            <Brain className="size-4 text-muted-foreground" />
            <h3 className="text-lg font-semibold">
              {t("settings.loaded_models.title")}
            </h3>
            {loading && (
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
            )}
          </div>

          <div className="flex items-center gap-2">
            {models.length > 0 && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <span>
                  {models.length === 1
                    ? t("settings.loaded_models.count_one", {
                        count: models.length
                      })
                    : t("settings.loaded_models.count_other", {
                        count: models.length
                      })}
                </span>
                <span>•</span>
                <span>{formatBytes(totalSize)}</span>
              </div>
            )}

            <div className="flex items-center gap-1">
              <TooltipActionButton
                variant="ghost"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation()
                  handleRefresh()
                }}
                disabled={refreshing}
                className="size-8 p-0"
                label={t("settings.loaded_models.refresh_tooltip")}
                icon={
                  <RefreshCw
                    className={cn("size-4", refreshing && "animate-spin")}
                  />
                }
              />

              <ChevronDown
                className={cn(
                  "size-4 transition-transform duration-200",
                  isExpanded && "rotate-180"
                )}
              />
            </div>
          </div>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="border-t border-border px-4 pb-4">
            {models.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-6 text-center">
                <Brain className="mb-2 size-8 text-muted-foreground/50" />
                <p className="text-sm text-muted-foreground">
                  {t("settings.loaded_models.no_models_title")}
                </p>
                <p className="mt-1 text-xs text-muted-foreground/70">
                  {t("settings.loaded_models.no_models_description")}
                </p>
              </div>
            ) : (
              <div className="flex flex-wrap gap-3 pt-4">
                {models.map((model) => (
                  <Card
                    key={model.name}
                    className="group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted">
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

                    <TooltipActionButton
                      size="sm"
                      variant="destructive"
                      className="size-8"
                      onClick={() => unloadModel(model.name)}
                      disabled={unloading === model.name}
                      label={t("settings.loaded_models.unload_tooltip", {
                        name: model.name
                      })}
                      icon={
                        unloading === model.name ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <Trash className="size-4" />
                        )
                      }
                    />
                  </Card>
                ))}
              </div>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  )
}
