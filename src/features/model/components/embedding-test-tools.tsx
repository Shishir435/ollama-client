import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { generateEmbedding } from "@/lib/embeddings/ollama-embedder"
import {
  getStorageStats,
  type SearchResult,
  searchSimilarVectors,
  storeVector
} from "@/lib/embeddings/vector-store"
import { Loader2, Search, Sparkles } from "@/lib/lucide-icon"

interface EmbeddingTestToolsProps {
  modelExists: boolean
}

export const EmbeddingTestTools = ({
  modelExists
}: EmbeddingTestToolsProps) => {
  const { t } = useTranslation()

  // Test Embedding State
  const [isTestingEmbedding, setIsTestingEmbedding] = useState(false)
  const [testResult, setTestResult] = useState<string | null>(null)

  // Search Test State
  const [searchQuery, setSearchQuery] = useState("")
  const [isSearching, setIsSearching] = useState(false)
  const [searchResults, setSearchResults] = useState<SearchResult[] | null>(
    null
  )

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
        timestamp: Date.now(),
        source: ""
      })

      const stats = await getStorageStats()
      const successMsg = `✅ Success! Embedding generated (${result.embedding.length}D) and stored (ID: ${id}). Total vectors: ${stats.totalVectors}`
      console.log("[Embedding Test]", successMsg)
      setTestResult(successMsg)
    } catch (error) {
      const errorMsg = `Error: ${error instanceof Error ? error.message : String(error)}`
      console.error("[Embedding Test]", errorMsg)
      setTestResult(errorMsg)
    } finally {
      setIsTestingEmbedding(false)
    }
  }

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

  if (!modelExists) return null

  return (
    <div className="space-y-4">
      {/* Test Embedding Generation */}
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
                {t("settings.embeddings.test_generation.button_testing")}
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

      {/* Test Semantic Search */}
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
            placeholder={t("settings.embeddings.test_search.placeholder")}
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
                      <Badge variant="outline" className="text-[10px] h-4 px-1">
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
    </div>
  )
}
