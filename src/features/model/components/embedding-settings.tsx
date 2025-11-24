import { useStorage } from "@plasmohq/storage/hook"
import { useCallback, useEffect, useState } from "react"
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
import { Label } from "@/components/ui/label"
import { MiniBadge } from "@/components/ui/mini-badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
import { FileUploadSettings } from "@/features/file-upload/components/file-upload-settings"
import { useOllamaPull } from "@/features/model/hooks/use-ollama-pull"
import { browser } from "@/lib/browser-api"
import {
  DEFAULT_EMBEDDING_MODEL,
  MESSAGE_KEYS,
  STORAGE_KEYS
} from "@/lib/constants"
import { generateEmbedding } from "@/lib/embeddings/ollama-embedder"
import {
  getStorageStats,
  type SearchResult,
  searchSimilarVectors,
  storeVector
} from "@/lib/embeddings/vector-store"
import {
  AlertCircle,
  CheckCircle,
  Download,
  Loader2,
  Search,
  Sparkles
} from "@/lib/lucide-icon"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"
import type { ChromeResponse } from "@/types"
import { EmbeddingConfigSettings } from "./embedding-config-settings"

export const EmbeddingSettings = () => {
  const { t } = useTranslation()
  const [selectedModel, setSelectedModel] = useStorage<string>(
    {
      key: STORAGE_KEYS.EMBEDDINGS.SELECTED_MODEL,
      instance: plasmoGlobalStorage
    },
    DEFAULT_EMBEDDING_MODEL
  )

  const [useRag, setUseRag] = useStorage<boolean>(
    {
      key: STORAGE_KEYS.EMBEDDINGS.USE_RAG,
      instance: plasmoGlobalStorage
    },
    true
  )

  const [autoDownloaded] = useStorage<boolean>(
    {
      key: STORAGE_KEYS.EMBEDDINGS.AUTO_DOWNLOADED,
      instance: plasmoGlobalStorage
    },
    false
  )

  const [modelExists, setModelExists] = useState<boolean | null>(null)
  const [isChecking, setIsChecking] = useState(false)
  const { pullingModel, progress, pullModel } = useOllamaPull()
  const [wasDownloading, setWasDownloading] = useState(false)

  const currentModel = selectedModel || DEFAULT_EMBEDDING_MODEL
  const isDownloading = pullingModel === currentModel

  // Track when download starts
  useEffect(() => {
    if (isDownloading) {
      setWasDownloading(true)
    }
  }, [isDownloading])

  const checkModel = useCallback(async () => {
    setIsChecking(true)
    try {
      const response = (await browser.runtime.sendMessage({
        type: MESSAGE_KEYS.OLLAMA.CHECK_EMBEDDING_MODEL,
        payload: currentModel
      })) as ChromeResponse & { data?: { exists?: boolean } }

      console.log(
        `[Embedding Settings] Check response for "${currentModel}":`,
        response
      )

      if (response?.success === true && response.data?.exists === true) {
        console.log(`[Embedding Settings] Model exists: true`)
        setModelExists(true)
      } else if (
        response?.success === true &&
        response.data?.exists === false
      ) {
        console.log(`[Embedding Settings] Model exists: false`)
        setModelExists(false)
      } else {
        console.warn(`[Embedding Settings] Invalid response:`, response)
        // On error, set to false
        setModelExists(false)
      }
    } catch (error) {
      console.error("Error checking embedding model:", error)
      setModelExists(false)
    } finally {
      setIsChecking(false)
    }
  }, [currentModel])

  useEffect(() => {
    checkModel()
  }, [checkModel])

  // Re-check model status when download completes
  useEffect(() => {
    // When download completes (progress is success, was downloading, but no longer downloading)
    if (
      progress === "✅ Success" &&
      wasDownloading &&
      !isDownloading &&
      pullingModel === null
    ) {
      console.log(
        "[Embedding Settings] Download completed, re-checking model status..."
      )
      // Wait a bit for Ollama to register the model
      setTimeout(() => {
        checkModel()
        // Mark as auto-downloaded
        plasmoGlobalStorage.set(STORAGE_KEYS.EMBEDDINGS.AUTO_DOWNLOADED, true)
        // Reset tracking
        setWasDownloading(false)
      }, 1500)
    }
  }, [progress, isDownloading, pullingModel, wasDownloading, checkModel])

  const handleDownload = () => {
    pullModel(currentModel)
  }

  const [isTestingEmbedding, setIsTestingEmbedding] = useState(false)
  const [testResult, setTestResult] = useState<string | null>(null)

  const handleTestEmbedding = async () => {
    setIsTestingEmbedding(true)
    setTestResult(null)
    try {
      const testText =
        "This is a test embedding. Vector embeddings enable semantic search."
      console.log("[Embedding Test] Starting embedding generation test...")

      const result = await generateEmbedding(testText)

      if ("error" in result) {
        const errorMsg = `Error: ${result.error}`
        console.error("[Embedding Test]", errorMsg)
        setTestResult(errorMsg)
        return
      }

      console.log(
        "[Embedding Test] Embedding generated:",
        result.embedding.length,
        "dimensions"
      )

      // Store in vector database
      const id = await storeVector(testText, result.embedding, {
        type: "chat",
        title: "Test Embedding",
        timestamp: Date.now()
      })

      const stats = await getStorageStats()
      const successMsg = `✅ Success! Embedding generated (${result.embedding.length}D) and stored (ID: ${id}). Total vectors: ${stats.totalVectors}`
      console.log("[Embedding Test]", successMsg)
      setTestResult(successMsg)

      // Refresh model check to show updated stats
      setTimeout(() => {
        checkModel()
      }, 500)
    } catch (error) {
      const errorMsg = `Error: ${error instanceof Error ? error.message : String(error)}`
      console.error("[Embedding Test]", errorMsg)
      setTestResult(errorMsg)
    } finally {
      setIsTestingEmbedding(false)
    }
  }

  const [searchQuery, setSearchQuery] = useState("")
  const [isSearching, setIsSearching] = useState(false)
  const [searchResults, setSearchResults] = useState<SearchResult[] | null>(
    null
  )

  const handleTestSearch = async () => {
    if (!searchQuery.trim()) return
    setIsSearching(true)
    setSearchResults(null)
    try {
      console.log(`[Search Test] Searching for: "${searchQuery}"`)

      // Generate embedding for query
      const embeddingResult = await generateEmbedding(searchQuery)

      if ("error" in embeddingResult) {
        console.error("[Search Test] Embedding error:", embeddingResult.error)
        return
      }

      // Search
      const results = await searchSimilarVectors(embeddingResult.embedding, {
        limit: 5,
        minSimilarity: 0.3
      })

      console.log(`[Search Test] Found ${results.length} results`)
      setSearchResults(results)
    } catch (error) {
      console.error("[Search Test] Error:", error)
    } finally {
      setIsSearching(false)
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-muted-foreground" />
            <CardTitle className="text-lg">
              {t("settings.embeddings.title")}
            </CardTitle>
            <MiniBadge text={t("settings.embeddings.beta_badge")} />
          </div>
          <CardDescription className="text-sm">
            {t("settings.embeddings.description")}
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">
                  {t("settings.embeddings.model_label")}
                </p>
                <p className="text-xs text-muted-foreground">
                  {selectedModel || DEFAULT_EMBEDDING_MODEL}
                </p>
              </div>
              {modelExists === true && (
                <Badge variant="default" className="gap-1">
                  <CheckCircle className="h-3 w-3" />
                  {t("settings.embeddings.status.installed")}
                </Badge>
              )}
              {modelExists === false && (
                <Badge variant="secondary" className="gap-1">
                  <AlertCircle className="h-3 w-3" />
                  {t("settings.embeddings.status.not_found")}
                </Badge>
              )}
            </div>

            {/* Show download prompt when model is not found */}
            {modelExists === false && !isDownloading && (
              <div className="rounded-lg border border-orange-500/20 bg-orange-500/5 p-4">
                <div className="flex items-start gap-3">
                  <AlertCircle className="h-5 w-5 text-orange-600 dark:text-orange-400 mt-0.5 shrink-0" />
                  <div className="flex-1 space-y-3">
                    <div>
                      <p className="text-sm font-medium text-orange-600 dark:text-orange-400 mb-1">
                        {t("settings.embeddings.not_loaded.title")}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {t("settings.embeddings.not_loaded.description")}
                      </p>
                    </div>
                    <Button
                      onClick={handleDownload}
                      size="sm"
                      className="w-full sm:w-auto">
                      <Download className="h-4 w-4 mr-2" />
                      {t("settings.embeddings.not_loaded.download_button", {
                        model: currentModel
                      })}
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {/* Show download progress when downloading */}
            {isDownloading && (
              <div className="rounded-lg border border-primary/20 bg-primary/5 p-4">
                <div className="flex items-start gap-3">
                  <Loader2 className="h-5 w-5 text-primary animate-spin mt-0.5 shrink-0" />
                  <div className="flex-1 space-y-2">
                    <p className="text-sm font-medium text-primary">
                      {t("settings.embeddings.downloading.title", {
                        model: currentModel
                      })}
                    </p>
                    {progress && (
                      <p className="text-xs text-muted-foreground">
                        {progress}
                      </p>
                    )}
                    <div className="w-full bg-muted rounded-full h-1.5 overflow-hidden">
                      <div
                        className="h-full bg-primary animate-pulse"
                        style={{ width: "100%" }}
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Show success message when download completes */}
            {progress === "✅ Success" && modelExists === true && (
              <div className="rounded-lg border border-green-500/20 bg-green-500/5 p-3">
                <div className="flex items-start gap-2">
                  <CheckCircle className="h-4 w-4 text-green-600 dark:text-green-400 mt-0.5" />
                  <div className="flex-1">
                    <p className="text-xs font-medium text-green-600 dark:text-green-400">
                      {t("settings.embeddings.success.title")}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {t("settings.embeddings.success.description")}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {autoDownloaded && modelExists === true && (
              <div className="rounded-lg border border-primary/20 bg-primary/5 p-3">
                <div className="flex items-start gap-2">
                  <Download className="h-4 w-4 text-primary mt-0.5" />
                  <div className="flex-1">
                    <p className="text-xs font-medium text-primary">
                      {t("settings.embeddings.auto_downloaded.title")}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {t("settings.embeddings.auto_downloaded.description")}
                    </p>
                  </div>
                </div>
              </div>
            )}

            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={checkModel}
                disabled={isChecking || isDownloading}
                className="flex-1">
                {isChecking ? (
                  <>
                    <Loader2 className="h-3 w-3 mr-2 animate-spin" />
                    {t("settings.embeddings.status.checking")}
                  </>
                ) : (
                  t("settings.embeddings.status.check_button")
                )}
              </Button>
              {modelExists === false && !isDownloading && (
                <Button onClick={handleDownload} size="sm" className="flex-1">
                  <Download className="h-3 w-3 mr-2" />
                  {t("model.embedding_status.download_button")}
                </Button>
              )}
            </div>

            {/* Test Embedding Generation */}
            {modelExists === true && (
              <div className="rounded-lg border border-muted bg-muted/30 p-4">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-sm font-medium">
                    {t("settings.embeddings.test_generation.title")}
                  </h4>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleTestEmbedding}
                    disabled={isTestingEmbedding}>
                    {isTestingEmbedding ? (
                      <>
                        <Loader2 className="h-3 w-3 mr-2 animate-spin" />
                        {t(
                          "settings.embeddings.test_generation.button_testing"
                        )}
                      </>
                    ) : (
                      <>
                        <Sparkles className="h-3 w-3 mr-1" />
                        {t("settings.embeddings.test_generation.button")}
                      </>
                    )}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground mb-2">
                  {t("settings.embeddings.test_generation.description")}
                </p>
                {testResult && (
                  <div
                    className={`text-xs p-2 rounded ${
                      testResult.startsWith("✅")
                        ? "bg-green-500/10 text-green-600 dark:text-green-400"
                        : "bg-red-500/10 text-red-600 dark:text-red-400"
                    }`}>
                    {testResult}
                  </div>
                )}
              </div>
            )}

            {/* Test Semantic Search */}
            {modelExists === true && (
              <div className="rounded-lg border border-muted bg-muted/30 p-4">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-sm font-medium">
                    {t("settings.embeddings.test_search.title")}
                  </h4>
                </div>
                <p className="text-xs text-muted-foreground mb-3">
                  {t("settings.embeddings.test_search.description")}
                </p>

                <div className="flex gap-2 mb-3">
                  <Input
                    placeholder={t(
                      "settings.embeddings.test_search.placeholder"
                    )}
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="h-8 text-xs"
                    onKeyDown={(e) => e.key === "Enter" && handleTestSearch()}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleTestSearch}
                    disabled={isSearching || !searchQuery.trim()}>
                    {isSearching ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Search className="h-3 w-3" />
                    )}
                  </Button>
                </div>

                {searchResults && (
                  <div className="space-y-2 mt-2">
                    <p className="text-xs font-medium text-muted-foreground">
                      {t("settings.embeddings.test_search.results_found", {
                        count: searchResults.length
                      })}
                    </p>
                    {searchResults.length === 0 ? (
                      <div className="text-xs text-muted-foreground italic p-2 border rounded bg-background/50">
                        {t("settings.embeddings.test_search.no_results")}
                      </div>
                    ) : (
                      <div className="space-y-2 max-h-[200px] overflow-y-auto pr-1 scrollbar-thin">
                        {searchResults.map((result) => (
                          <div
                            key={result.document.id}
                            className="text-xs p-2 rounded border bg-background/50 space-y-1">
                            <div className="flex justify-between items-center">
                              <span className="font-medium truncate max-w-[180px]">
                                {result.document.metadata.title || "Untitled"}
                              </span>
                              <Badge
                                variant="outline"
                                className="text-[10px] h-4 px-1">
                                {(result.similarity * 100).toFixed(1)}%
                              </Badge>
                            </div>
                            <p className="text-muted-foreground line-clamp-2 text-[10px]">
                              {result.document.content}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="rounded-lg border border-muted bg-muted/30 p-4">
            <h4 className="text-sm font-medium mb-2">
              {t("settings.embeddings.what_are_embeddings.title")}
            </h4>
            <ul className="text-xs text-muted-foreground space-y-1 list-disc list-inside">
              <li>{t("settings.embeddings.what_are_embeddings.point_1")}</li>
              <li>{t("settings.embeddings.what_are_embeddings.point_2")}</li>
              <li>{t("settings.embeddings.what_are_embeddings.point_3")}</li>
              <li>{t("settings.embeddings.what_are_embeddings.point_4")}</li>
            </ul>
          </div>

          <div className="rounded-lg border p-4 space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="rag-mode">
                  {t("settings.embeddings.rag_mode.label")}
                </Label>
                <p className="text-xs text-muted-foreground">
                  {t("settings.embeddings.rag_mode.description")}
                </p>
              </div>
              <Switch
                id="rag-mode"
                checked={useRag}
                onCheckedChange={setUseRag}
              />
            </div>

            <Separator />

            <FileUploadSettings />

            <Separator />

            <div className="space-y-2">
              <Label>{t("settings.embeddings.model_select.label")}</Label>
              <Select
                value={selectedModel}
                onValueChange={(value) => setSelectedModel(value)}>
                <SelectTrigger>
                  <SelectValue
                    placeholder={t(
                      "settings.embeddings.model_select.placeholder"
                    )}
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="mxbai-embed-large">
                    mxbai-embed-large (
                    {t("settings.content_extraction.badges.recommended")})
                  </SelectItem>
                  <SelectItem value="nomic-embed-text">
                    nomic-embed-text
                  </SelectItem>
                  <SelectItem value="all-minilm">all-minilm</SelectItem>
                  <SelectItem value="snowflake-arctic-embed">
                    snowflake-arctic-embed
                  </SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {t("settings.embeddings.model_select.description")}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Separator />

      {/* Configuration Settings */}
      <EmbeddingConfigSettings />
    </div>
  )
}
