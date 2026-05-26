import { useState } from "react"
import { useTranslation } from "react-i18next"
import { SettingsCard } from "@/components/settings"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { generateEmbedding } from "@/lib/embeddings/embedding-client"
import {
  type SearchResult,
  searchSimilarVectors
} from "@/lib/embeddings/vector-store"
import { Loader2, Search } from "@/lib/lucide-icon"

export interface EmbeddingTestSearchProps {
  modelExists: boolean
}

export const EmbeddingTestSearch = ({
  modelExists
}: EmbeddingTestSearchProps) => {
  const { t } = useTranslation()
  const [query, setQuery] = useState("")
  const [isSearching, setIsSearching] = useState(false)
  const [results, setResults] = useState<SearchResult[] | null>(null)

  if (!modelExists) return null

  const handleSearch = async () => {
    if (!query.trim()) return
    setIsSearching(true)
    setResults(null)
    try {
      const embeddingResult = await generateEmbedding(query)

      if ("error" in embeddingResult) return

      const searchResults = await searchSimilarVectors(
        embeddingResult.embedding,
        {
          limit: 5,
          minSimilarity: 0.3,
          embeddingModel: embeddingResult.model,
          embeddingProviderId: embeddingResult.providerId,
          embeddingDimension: embeddingResult.embedding.length
        }
      )

      setResults(searchResults)
    } catch {
      // silently fail
    } finally {
      setIsSearching(false)
    }
  }

  return (
    <SettingsCard
      icon={Search}
      title={t("settings.embeddings.test_search.title")}
      description={t("settings.embeddings.test_search.description")}>
      <div className="flex gap-2 mb-3">
        <Input
          placeholder={t("settings.embeddings.test_search.placeholder")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="h-8 text-xs"
          onKeyDown={(e) => e.key === "Enter" && handleSearch()}
        />
        <Button
          variant="outline"
          size="sm"
          onClick={handleSearch}
          disabled={isSearching || !query.trim()}>
          {isSearching ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Search className="h-3 w-3" />
          )}
        </Button>
      </div>

      {results && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">
            {t("settings.embeddings.test_search.results_found", {
              count: results.length
            })}
          </p>
          {results.length === 0 ? (
            <div className="text-xs text-muted-foreground italic p-2 border rounded bg-background/50">
              {t("settings.embeddings.test_search.no_results")}
            </div>
          ) : (
            <div className="space-y-2 max-h-[200px] overflow-y-auto pr-1 scrollbar-thin">
              {results.map((result) => (
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
    </SettingsCard>
  )
}
