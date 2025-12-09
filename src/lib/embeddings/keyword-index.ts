import MiniSearch from "minisearch"
import { logger } from "@/lib/logger"
import type { VectorDocument } from "./vector-store"

/**
 * Keyword search result
 */
export interface KeywordSearchResult {
  id: number
  score: number
  document: VectorDocument
  terms: string[] // Matched keywords
}

/**
 * Keyword Index for full-text search using BM25 algorithm
 * Provides fast exact keyword matching to complement semantic search
 */
class KeywordIndexManager {
  private index: MiniSearch<{ id: number; content: string; timestamp: number }>
  private documents: Map<number, VectorDocument> = new Map()

  constructor() {
    this.index = new MiniSearch({
      fields: ["content"], // Fields to index
      storeFields: ["content", "timestamp"], // Fields to store
      idField: "id",
      searchOptions: {
        boost: { content: 2 },
        fuzzy: 0.2, // Allow minor typos
        prefix: true, // Match word prefixes
        combineWith: "AND" // All terms must match
      }
    })
  }

  /**
   * Add document to keyword index
   */
  addDocument(id: number, content: string, document: VectorDocument): void {
    try {
      // Remove existing if updating
      if (this.documents.has(id)) {
        this.removeDocument(id)
      }

      this.documents.set(id, document)
      this.index.add({
        id,
        content: content.toLowerCase(), // Normalize for better matching
        timestamp: document.metadata.timestamp
      })
    } catch (error) {
      logger.error("Failed to add document to keyword index", "KeywordIndex", {
        error
      })
    }
  }

  /**
   * Search for documents matching keywords
   */
  search(
    query: string,
    options: {
      limit?: number
      fuzzy?: number // 0-1, typo tolerance
      prefix?: boolean // Match word prefixes
      combineWith?: "AND" | "OR"
    } = {}
  ): KeywordSearchResult[] {
    if (!query.trim()) {
      return []
    }

    try {
      const results = this.index.search(query.toLowerCase(), {
        fuzzy: options.fuzzy ?? 0.2,
        prefix: options.prefix ?? true,
        combineWith: options.combineWith ?? "OR", // OR for better recall
        boost: { content: 2 }
      })

      return results
        .slice(0, options.limit ?? 50)
        .map((result) => ({
          id: result.id,
          score: result.score,
          document: this.documents.get(result.id),
          terms: result.terms || []
        }))
        .filter((r): r is KeywordSearchResult => r.document !== undefined)
    } catch (error) {
      logger.error("Keyword search failed", "KeywordIndex", { error })
      return []
    }
  }

  /**
   * Remove document from index
   */
  removeDocument(id: number): void {
    try {
      if (this.documents.has(id)) {
        this.index.remove({ id } as {
          id: number
          content: string
          timestamp: number
        })
        this.documents.delete(id)
      }
    } catch (error) {
      logger.error(
        "Failed to remove document from keyword index",
        "KeywordIndex",
        { error }
      )
    }
  }

  /**
   * Clear all documents
   */
  clear(): void {
    this.index.removeAll()
    this.documents.clear()
    logger.verbose("Keyword index cleared", "KeywordIndex")
  }

  /**
   * Get index statistics
   */
  getStats() {
    return {
      documentCount: this.index.documentCount,
      termCount: this.documents.size,
      memorySizeMB:
        (JSON.stringify(Array.from(this.documents.values())).length +
          this.index.documentCount * 100) /
        (1024 * 1024)
    }
  }

  /**
   * Build index from existing documents
   */
  async buildFromDocuments(
    documents: VectorDocument[],
    onProgress?: (current: number, total: number) => void
  ): Promise<void> {
    logger.info("Building keyword index from documents", "KeywordIndex", {
      count: documents.length
    })
    const startTime = performance.now()

    this.clear()

    // Process in batches
    const BATCH_SIZE = 100
    let processed = 0

    for (let i = 0; i < documents.length; i += BATCH_SIZE) {
      const batch = documents.slice(i, i + BATCH_SIZE)

      for (const doc of batch) {
        if (doc.id !== undefined) {
          this.addDocument(doc.id, doc.content, doc)
          processed++
        }
      }

      onProgress?.(processed, documents.length)
      await new Promise((resolve) => setTimeout(resolve, 0)) // Yield
    }

    const duration = performance.now() - startTime
    logger.info("Keyword index built successfully", "KeywordIndex", {
      count: documents.length,
      duration: `${duration.toFixed(2)}ms`
    })
  }
}

// Export singleton instance
export const keywordIndexManager = new KeywordIndexManager()
