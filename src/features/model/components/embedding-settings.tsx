import { useStorage } from "@plasmohq/storage/hook"
import { useCallback, useEffect, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { useOllamaPull } from "@/features/model/hooks/use-ollama-pull"
import { browser } from "@/lib/browser-api"
import {
  DEFAULT_EMBEDDING_MODEL,
  MESSAGE_KEYS,
  STORAGE_KEYS
} from "@/lib/constants"
import { generateEmbedding } from "@/lib/embeddings/ollama-embedder"
import { getStorageStats, storeVector } from "@/lib/embeddings/vector-store"
import {
  AlertCircle,
  CheckCircle,
  Download,
  Loader2,
  Sparkles
} from "@/lib/lucide-icon"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"
import type { ChromeResponse } from "@/types"
import { EmbeddingConfigSettings } from "./embedding-config-settings"

export const EmbeddingSettings = () => {
  const [selectedModel] = useStorage<string>(
    {
      key: STORAGE_KEYS.EMBEDDINGS.SELECTED_MODEL,
      instance: plasmoGlobalStorage
    },
    DEFAULT_EMBEDDING_MODEL
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

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-muted-foreground" />
            <CardTitle className="text-lg">Vector Embeddings</CardTitle>
            <Badge variant="secondary" className="text-xs">
              Beta v0.3.0
            </Badge>
          </div>
          <CardDescription className="text-sm">
            Embeddings enable semantic search, RAG (Retrieval Augmented
            Generation), and context-aware features for file uploads and chat
            history.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Embedding Model</p>
                <p className="text-xs text-muted-foreground">
                  {selectedModel || DEFAULT_EMBEDDING_MODEL}
                </p>
              </div>
              {modelExists === true && (
                <Badge variant="default" className="gap-1">
                  <CheckCircle className="h-3 w-3" />
                  Installed
                </Badge>
              )}
              {modelExists === false && (
                <Badge variant="secondary" className="gap-1">
                  <AlertCircle className="h-3 w-3" />
                  Not Found
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
                        Embedding Model Not Loaded
                      </p>
                      <p className="text-xs text-muted-foreground">
                        The embedding model is required for semantic search, RAG
                        (Retrieval Augmented Generation), and context-aware
                        features. Download it now to enhance your chat
                        experience with better context understanding and file
                        search capabilities.
                      </p>
                    </div>
                    <Button
                      onClick={handleDownload}
                      size="sm"
                      className="w-full sm:w-auto">
                      <Download className="h-4 w-4 mr-2" />
                      Download {currentModel}
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
                      Downloading {currentModel}...
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
                      Successfully downloaded!
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      The embedding model is now ready to use. You can now enjoy
                      enhanced chat experiences with semantic search and
                      context-aware features.
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
                      Auto-downloaded on install
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      The embedding model was automatically downloaded when you
                      installed the extension.
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
                    Checking...
                  </>
                ) : (
                  "Check Status"
                )}
              </Button>
              {modelExists === false && !isDownloading && (
                <Button onClick={handleDownload} size="sm" className="flex-1">
                  <Download className="h-3 w-3 mr-2" />
                  Download
                </Button>
              )}
            </div>

            {/* Test Embedding Generation */}
            {modelExists === true && (
              <div className="rounded-lg border border-muted bg-muted/30 p-4">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-sm font-medium">
                    Test Embedding Generation
                  </h4>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleTestEmbedding}
                    disabled={isTestingEmbedding}>
                    {isTestingEmbedding ? (
                      <>
                        <Loader2 className="h-3 w-3 mr-2 animate-spin" />
                        Testing...
                      </>
                    ) : (
                      <>
                        <Sparkles className="h-3 w-3 mr-1" />
                        Test
                      </>
                    )}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground mb-2">
                  Generate a test embedding to verify the embedding model is
                  working correctly.
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
          </div>

          <div className="rounded-lg border border-muted bg-muted/30 p-4">
            <h4 className="text-sm font-medium mb-2">What are embeddings?</h4>
            <ul className="text-xs text-muted-foreground space-y-1 list-disc list-inside">
              <li>
                Convert text into numerical vectors that capture semantic
                meaning
              </li>
              <li>
                Enable semantic search across your chat history and uploaded
                files
              </li>
              <li>
                Power RAG (Retrieval Augmented Generation) for context-aware
                responses
              </li>
              <li>
                Help find relevant context from files for better AI responses
              </li>
            </ul>
          </div>

          <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-4">
            <h4 className="text-sm font-medium mb-2 text-blue-600 dark:text-blue-400">
              Coming Soon
            </h4>
            <p className="text-xs text-muted-foreground">
              File upload with automatic embedding generation and semantic
              search will be available in a future update. The embedding model
              is already set up and ready to use!
            </p>
          </div>
        </CardContent>
      </Card>

      <Separator />

      {/* Configuration Settings */}
      <EmbeddingConfigSettings />
    </div>
  )
}
