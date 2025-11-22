import { useCallback, useState } from "react"

import type { EmbeddingConfig } from "@/lib/constants"
import { STORAGE_KEYS } from "@/lib/constants"
import { generateEmbedding } from "@/lib/embeddings/ollama-embedder"
import type { SearchResult } from "@/lib/embeddings/vector-store"
import { searchSimilarVectors } from "@/lib/embeddings/vector-store"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"

export interface FileSearchResult {
  result: SearchResult
  fileId: string
  fileName: string
  chunkIndex: number
  totalChunks: number
  timestamp: number
}

export interface UseFileSearchOptions {
  limit?: number
  minSimilarity?: number
  fileId?: string // Filter by specific file
}

/**
 * Hook for searching uploaded files using semantic search
 */
export const useFileSearch = () => {
  const [isSearching, setIsSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const search = useCallback(
    async (
      query: string,
      options: UseFileSearchOptions = {}
    ): Promise<FileSearchResult[]> => {
      if (!query.trim()) {
        return []
      }

      setIsSearching(true)
      setError(null)

      try {
        // Get embedding config
        const embeddingConfig = await plasmoGlobalStorage.get<EmbeddingConfig>(
          STORAGE_KEYS.EMBEDDINGS.CONFIG
        )

        // Generate embedding for query
        const embeddingResult = await generateEmbedding(query.trim())

        if ("error" in embeddingResult) {
          throw new Error(embeddingResult.error)
        }

        // Get search options
        const searchOptions = {
          limit: options.limit ?? embeddingConfig?.defaultSearchLimit ?? 10,
          minSimilarity:
            options.minSimilarity ??
            embeddingConfig?.defaultMinSimilarity ??
            0.5,
          type: "file" as const,
          fileId: options.fileId
        }

        // Search for similar vectors
        const results = await searchSimilarVectors(
          embeddingResult.embedding,
          searchOptions
        )

        // Transform results to include file info
        const fileResults: FileSearchResult[] = results.map((result) => ({
          result,
          fileId: result.document.metadata.fileId || "",
          fileName: result.document.metadata.title || "Unknown",
          chunkIndex: result.document.metadata.chunkIndex || 0,
          totalChunks: result.document.metadata.totalChunks || 1,
          timestamp: result.document.metadata.timestamp
        }))

        return fileResults
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : "Search failed"
        setError(errorMessage)
        console.error("File search error:", err)
        return []
      } finally {
        setIsSearching(false)
      }
    },
    []
  )

  return {
    search,
    isSearching,
    error
  }
}
