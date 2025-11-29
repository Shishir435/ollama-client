import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { ModelList } from "@/features/model/components/model-list"
import { useOllamaModelSearch } from "@/features/model/hooks/use-ollama-model-search"
import { useOllamaPull } from "@/features/model/hooks/use-ollama-pull"
import { useDebounce } from "@/hooks/use-debounce"
import {
  Download,
  ExternalLink,
  Info,
  Loader2,
  Package,
  Search,
  Trash
} from "@/lib/lucide-icon"
import { cn } from "@/lib/utils"

export const ModelPullPanel = () => {
  const { t } = useTranslation()
  const [progressMap, setProgressMap] = useState<Record<string, string>>({})
  const [cancelledModels, setCancelledModels] = useState<Set<string>>(new Set())
  const [searchTerm, setSearchTerm] = useState("")
  const [loadingVariantsFor, setLoadingVariantsFor] = useState<string | null>(
    null
  )

  const { models, setSearchQuery, loading, loadVariants } =
    useOllamaModelSearch()
  const { pullModel, progress, pullingModel, cancelPull } = useOllamaPull()

  const debouncedSearchTerm = useDebounce(searchTerm, 300)

  useEffect(() => {
    setSearchQuery(debouncedSearchTerm)
  }, [debouncedSearchTerm, setSearchQuery])

  const handleLoadVariants = async (modelName: string) => {
    if (loadingVariantsFor) return
    setLoadingVariantsFor(modelName)
    try {
      await loadVariants(modelName)
    } finally {
      setLoadingVariantsFor(null)
    }
  }

  useEffect(() => {
    if (pullingModel && progress) {
      setProgressMap((prev) => ({ ...prev, [pullingModel]: progress }))
    }
  }, [pullingModel, progress])

  const handleCancel = () => {
    if (pullingModel) {
      setCancelledModels((prev) => new Set(prev).add(pullingModel))
      cancelPull()
      setTimeout(() => {
        setProgressMap((prev) => {
          const updated = { ...prev }
          delete updated[pullingModel]
          return updated
        })
        setCancelledModels((prev) => {
          const updated = new Set(prev)
          updated.delete(pullingModel)
          return updated
        })
      }, 2500)
    }
  }

  return (
    <div className="mx-auto space-y-4">
      <Card>
        <CardHeader className="pb-4">
          <div className="mb-2 flex items-center gap-2">
            <Package className="h-5 w-5 text-muted-foreground" />
            <CardTitle className="text-xl">
              {t("settings.model_pull.title")}
            </CardTitle>
          </div>
          <CardDescription>
            {t("settings.model_pull.description")}
          </CardDescription>
          <div className="pt-3">
            <ModelList />
          </div>
        </CardHeader>

        <CardContent className="space-y-5">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder={t("settings.model_pull.search_placeholder")}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="h-10 bg-background pl-10"
            />
          </div>

          {Object.entries(progressMap).map(([model, prog]) => (
            <Card
              key={model}
              className="rounded-lg border-2 border-primary/20 bg-primary/5">
              <CardContent className="flex items-center justify-between p-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10">
                    <Download className="h-4 w-4 text-primary" />
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm font-medium">
                      {cancelledModels.has(model)
                        ? t("settings.model_pull.status.cancelled", { model })
                        : t("settings.model_pull.status.downloading", {
                            model
                          })}
                    </p>
                    <p className="text-xs text-muted-foreground">{prog}</p>
                  </div>
                </div>
                {!cancelledModels.has(model) && (
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={handleCancel}
                    className="h-8 w-8 p-0">
                    <Trash className="h-4 w-4" />
                  </Button>
                )}
              </CardContent>
            </Card>
          ))}

          {loading ? (
            <div className="flex flex-1 items-center justify-center py-12">
              <div className="flex flex-col items-center gap-3">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  {t("settings.model_pull.status.loading_models")}
                </p>
              </div>
            </div>
          ) : (
            <div className="min-h-0 flex-1">
              <ScrollArea className="h-[400px] rounded-lg border">
                <div className="space-y-3 p-4">
                  {models.length === 0 ? (
                    <div className="flex flex-1 items-center justify-center py-12">
                      <div className="flex flex-col items-center gap-3 text-center">
                        <Package className="h-12 w-12 text-muted-foreground/50" />
                        <div className="space-y-1">
                          <p className="text-sm font-medium">
                            {t("settings.model_pull.status.no_models")}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {t("settings.model_pull.status.adjust_search")}
                          </p>
                        </div>
                      </div>
                    </div>
                  ) : (
                    models.map((model) => (
                      <Card
                        key={model.name}
                        className="group transition-all hover:border-primary/20 hover:shadow-sm">
                        <CardHeader className="pb-3">
                          <div className="flex items-start justify-between gap-4">
                            <div className="flex-1 space-y-1">
                              <CardTitle className="flex items-center gap-2 text-lg">
                                {model.name}
                                {model.size && (
                                  <Badge
                                    variant="secondary"
                                    className="font-mono text-xs">
                                    {model.size}
                                  </Badge>
                                )}
                              </CardTitle>
                              {model.description && (
                                <CardDescription className="text-sm leading-relaxed">
                                  {model.description}
                                </CardDescription>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              {model.url && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-8 w-8 p-0 opacity-60 group-hover:opacity-100"
                                  asChild>
                                  <a
                                    href={model.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="flex items-center justify-center">
                                    <ExternalLink className="h-4 w-4" />
                                  </a>
                                </Button>
                              )}
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleLoadVariants(model.name)}
                                disabled={loadingVariantsFor === model.name}
                                className="transition-all hover:bg-primary hover:text-primary-foreground">
                                {loadingVariantsFor === model.name ? (
                                  <>
                                    <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                                    {t("settings.model_pull.button.loading")}
                                  </>
                                ) : (
                                  <>
                                    <Info className="mr-2 h-3 w-3" />
                                    {t("settings.model_pull.button.variants")}
                                  </>
                                )}
                              </Button>
                            </div>
                          </div>
                        </CardHeader>

                        {model.variants?.length > 0 && (
                          <>
                            <Separator />
                            <CardContent className="pt-4">
                              <div className="space-y-3">
                                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                  {t("settings.model_pull.variants_label")}
                                </p>
                                <div className="flex flex-wrap gap-2">
                                  {model.variants.map((variant) => {
                                    const isPulling = pullingModel === variant
                                    const isAnyModelPulling = !!pullingModel
                                    return (
                                      <Button
                                        key={variant}
                                        size="sm"
                                        variant={
                                          isPulling ? "default" : "secondary"
                                        }
                                        disabled={isAnyModelPulling}
                                        onClick={() => pullModel(variant)}
                                        className={cn(
                                          "h-8 font-mono text-xs transition-all",
                                          isPulling
                                            ? "cursor-wait bg-primary/90"
                                            : isAnyModelPulling
                                              ? "cursor-not-allowed opacity-50"
                                              : "hover:bg-primary hover:text-primary-foreground"
                                        )}>
                                        {isPulling ? (
                                          <>
                                            <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                                            {t(
                                              "settings.model_pull.button.pulling"
                                            )}
                                          </>
                                        ) : (
                                          <>
                                            <Download className="mr-1.5 h-3 w-3" />
                                            {variant}
                                          </>
                                        )}
                                      </Button>
                                    )
                                  })}
                                </div>
                              </div>
                            </CardContent>
                          </>
                        )}
                      </Card>
                    ))
                  )}
                </div>
              </ScrollArea>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
