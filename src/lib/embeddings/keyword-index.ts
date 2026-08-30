import MiniSearch from "minisearch"
import { logger } from "@/lib/logger"
import type { VectorDocument } from "./vector-store"

/**
 * What the index retains per document.
 *
 * Deliberately not a `VectorDocument`: the full row carries `embedding` and
 * `normalizedEmbedding`, two float arrays that a BM25 index never reads. The
 * index held both for every document in the corpus, in JS `number[]` (float64,
 * twice the width of the Float32Array copy the ANN backend already keeps), on
 * top of MiniSearch's own stored content — the largest resident allocation in
 * the extension, for data that is already in IndexedDB.
 *
 * `embeddingDim` is captured at add time because candidate filtering needs the
 * dimension and `metadata.embeddingDim` is absent on older rows, where the
 * fallback was `document.embedding.length`. Keeping it here is what lets
 * filtering stay synchronous after the arrays are dropped.
 */
export interface KeywordIndexDocument {
  id?: number
  content: string
  embeddingDim: number
  metadata: VectorDocument["metadata"]
}

/**
 * Keyword search result.
 *
 * `document` is the retained projection, not the stored row. Callers that need
 * the vectors — reranking, fusion output — must rehydrate the surviving
 * candidates from IndexedDB; see `hydrateKeywordCandidates` in `search.ts`.
 */
export interface KeywordSearchResult {
  id: number
  score: number
  document: KeywordIndexDocument
  terms: string[] // Matched keywords
}

const toIndexDocument = (document: VectorDocument): KeywordIndexDocument => ({
  id: document.id,
  content: document.content,
  embeddingDim: document.metadata.embeddingDim ?? document.embedding.length,
  metadata: document.metadata
})

/**
 * Keyword Index for full-text search using BM25 algorithm
 * Provides fast exact keyword matching to complement semantic search
 */
class KeywordIndexManager {
  private index: MiniSearch<{
    id: number
    content: string
    searchText: string
    timestamp: number
  }>
  private documents: Map<number, KeywordIndexDocument> = new Map()
  /** Running total of retained content, so stats never walk the corpus. */
  private retainedContentChars = 0

  constructor() {
    this.index = new MiniSearch({
      // Include source/title so filename-only questions can retrieve their
      // chunks. Keep content separately for the stored projection returned to
      // callers.
      fields: ["searchText"],
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

      const projected = toIndexDocument(document)
      this.documents.set(id, projected)
      this.retainedContentChars += projected.content.length
      const searchableMetadata = [
        projected.metadata.source,
        projected.metadata.title
      ]
        .filter(Boolean)
        .join(" ")
      this.index.add({
        id,
        content: content.toLowerCase(), // Normalize for better matching
        searchText: `${content} ${searchableMetadata}`.toLowerCase(),
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
      const existing = this.documents.get(id)
      if (existing) {
        this.index.remove({ id } as {
          id: number
          content: string
          searchText: string
          timestamp: number
        })
        this.documents.delete(id)
        this.retainedContentChars -= existing.content.length
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
    this.retainedContentChars = 0
    logger.verbose("Keyword index cleared", "KeywordIndex")
  }

  /**
   * Get index statistics.
   *
   * `memorySizeMB` is estimated from a running character count. It used to
   * `JSON.stringify` every retained document — including both embedding arrays,
   * rendered as decimal text — which allocated a string several times the size
   * of the corpus purely to produce a diagnostic number, on a path reached from
   * search warm-up.
   */
  getStats() {
    return {
      documentCount: this.index.documentCount,
      termCount: this.documents.size,
      memorySizeMB:
        (this.retainedContentChars * 2 + this.index.documentCount * 100) /
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

/** Export singleton instance */
export const keywordIndexManager = new KeywordIndexManager()
