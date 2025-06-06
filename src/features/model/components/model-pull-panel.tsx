import { useEffect, useState } from "react"

import {
  Download,
  ExternalLink,
  Info,
  Loader2,
  Package,
  Search,
  Trash
} from "lucide-react"

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
import { useDebounce } from "@/hooks/use-debounce"
import { cn } from "@/lib/utils"
import ModelList from "@/features/model/components/model-list"
import { useOllamaModelSearch } from "@/features/model/hooks/use-ollama-model-search"
import { useOllamaPull } from "@/features/model/hooks/use-ollama-pull"

export const ModelPullPanel = () => {
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
  }, [debouncedSearchTerm])

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
    <div className="flex h-full flex-col space-y-6 p-6">
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Package className="h-5 w-5" />
          <h2 className="text-2xl font-bold tracking-tight">Model Library</h2>
        </div>
        <p className="text-muted-foreground">
          Discover and download AI models for your projects
        </p>
        <div>
          <ModelList />
        </div>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search models by name or description..."
          onChange={(e) => setSearchTerm(e.target.value)}
          className="h-11 border-2 bg-background/50 pl-10 transition-all focus:bg-background"
        />
      </div>

      {Object.entries(progressMap).map(([model, prog]) => (
        <Card
          key={model}
          className="border-2 border-blue-200 bg-blue-50/50 dark:border-blue-800 dark:bg-blue-950/20">
          <CardContent className="flex items-center justify-between p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-900">
                <Download className="h-4 w-4 text-blue-600 dark:text-blue-400" />
              </div>
              <div className="space-y-1">
                <p className="text-sm font-medium">
                  {cancelledModels.has(model)
                    ? `Cancelled ${model}`
                    : `Downloading ${model}`}
                </p>
                <p className="text-xs text-muted-foreground">{prog}</p>
              </div>
            </div>
            {!cancelledModels.has(model) && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleCancel}
                className="h-8 w-8 p-0 hover:bg-red-100 hover:text-red-600 dark:hover:bg-red-950 dark:hover:text-red-400">
                <Trash className="h-4 w-4" />
              </Button>
            )}
          </CardContent>
        </Card>
      ))}

      {loading ? (
        <div className="flex flex-1 items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Loading models...</p>
          </div>
        </div>
      ) : (
        <div className="min-h-0 flex-1">
          <ScrollArea className="h-[400px] rounded-lg border-2">
            <div className="space-y-4 p-4">
              {models.length === 0 ? (
                <div className="flex flex-1 items-center justify-center py-12">
                  <div className="flex flex-col items-center gap-3 text-center">
                    <Package className="h-12 w-12 text-muted-foreground/50" />
                    <div className="space-y-1">
                      <p className="text-sm font-medium">No models found</p>
                      <p className="text-xs text-muted-foreground">
                        Try adjusting your search terms
                      </p>
                    </div>
                  </div>
                </div>
              ) : (
                models.map((model) => (
                  <Card
                    key={model.name}
                    className="group transition-all hover:border-primary/20 hover:shadow-md">
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
                                Loading
                              </>
                            ) : (
                              <>
                                <Info className="mr-2 h-3 w-3" />
                                Variants
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
                              Available Variants
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
                                        Pulling
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
    </div>
  )
}
