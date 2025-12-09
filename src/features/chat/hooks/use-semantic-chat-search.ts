import { useStorage } from "@plasmohq/storage/hook"
import { useCallback, useState } from "react"
import type { EmbeddingConfig } from "@/lib/constants"
import { STORAGE_KEYS } from "@/lib/constants"
import { ensureKeywordIndexBuilt } from "@/lib/embeddings/auto-index"
import { generateEmbedding } from "@/lib/embeddings/ollama-embedder"
import type { SearchResult } from "@/lib/embeddings/vector-store"
import { searchHybrid } from "@/lib/embeddings/vector-store"
import { logger } from "@/lib/logger"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"

export interface ChatSearchResult {
  result: SearchResult
  sessionId: string
  messageContent: string
  role: "user" | "assistant"
  timestamp: number
}

export interface UseSemanticChatSearchOptions {
  limit?: number
  minSimilarity?: number
  sessionId?: string // Filter by specific session
}

export const useSemanticChatSearch = () => {
  const [isSearching, setIsSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [embeddingConfig] = useStorage<EmbeddingConfig>(
    {
      key: STORAGE_KEYS.EMBEDDINGS.CONFIG,
      instance: plasmoGlobalStorage
    },
    undefined
  )

  const search = useCallback(
    async (
      query: string,
      options: UseSemanticChatSearchOptions = {}
    ): Promise<ChatSearchResult[]> => {
      if (!query.trim()) {
        return []
      }

      setIsSearching(true)
      setError(null)

      try {
        // Generate embedding for query
        const embeddingResult = await generateEmbedding(query.trim())

        if ("error" in embeddingResult) {
          throw new Error(embeddingResult.error)
        }

        // Get search options from config or provided options
        const config = embeddingConfig
        const searchOptions = {
          limit: options.limit ?? config?.defaultSearchLimit ?? 10,
          minSimilarity:
            options.minSimilarity ?? config?.defaultMinSimilarity ?? 0.7,
          type: "chat" as const,
          sessionId: options.sessionId
        }

        // Auto-build keyword index on first use (backward compatibility)
        try {
          await ensureKeywordIndexBuilt()
        } catch (indexError) {
          logger.warn(
            "Keyword Index auto-build failed, continuing without keyword search",
            "useSemanticChatSearch",
            { error: indexError }
          )
          // Continue with semantic-only search
        }

        // Use hybrid search (keyword + semantic) for better exact matching
        const results = await searchHybrid(
          query.trim(), // Raw text for keyword search
          embeddingResult.embedding, // Embedding for semantic search
          searchOptions
        )

        // Transform results to include session info
        const chatResults: ChatSearchResult[] = results.map((result) => ({
          result,
          sessionId: result.document.metadata.sessionId || "",
          messageContent: result.document.content,
          role: result.document.metadata.title?.includes("User")
            ? "user"
            : "assistant",
          timestamp: result.document.metadata.timestamp
        }))

        return chatResults
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : "Search failed"
        setError(errorMessage)
        logger.error("Semantic search error", "useSemanticChatSearch", {
          error: err
        })
        return []
      } finally {
        setIsSearching(false)
      }
    },
    [embeddingConfig]
  )

  return {
    search,
    isSearching,
    error
  }
}
