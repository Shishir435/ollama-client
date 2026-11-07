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
 * It keeps no `content` either: MiniSearch already holds the tokenised text, and
 * every caller that needs the words reads the surviving candidates back from
 * IndexedDB, so a second copy of each chunk was resident for nothing.
 *
 * `embeddingDim` is captured at add time because candidate filtering needs the
 * dimension and `metadata.embeddingDim` is absent on older rows, where the
 * fallback was `document.embedding.length`. Keeping it here is what lets
 * filtering stay synchronous after the arrays are dropped.
 */
export interface KeywordIndexDocument {
  id?: number
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

/**
 * Resident bytes per indexed character, measured after GC on a 100k-chunk
 * corpus of 500-character chunks: 225 MB retained, about 2.3 KB per chunk. A
 * synthetic vocabulary is a rough stand-in for real text, so this is an
 * estimate for diagnostics, not an allocation.
 */
const RESIDENT_BYTES_PER_INDEXED_CHAR = 5

/**
 * Shortest query term allowed to match as a prefix. A one- or two-letter prefix
 * expands to a large share of the vocabulary, and under OR every expansion is
 * scored: at 100k chunks that was 930 ms against 82 ms without prefixes, for
 * hits too diffuse to rank.
 */
const MIN_PREFIX_TERM_LENGTH = 3

const toIndexDocument = (document: VectorDocument): KeywordIndexDocument => ({
  id: document.id,
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
    searchText: string
    timestamp: number
  }>
  private documents: Map<number, KeywordIndexDocument> = new Map()
  private textLengths: Map<number, number> = new Map()
  /** Running total of indexed text, so stats never walk the corpus. */
  private indexedTextChars = 0
  /** Increments on `clear()` so a build can tell the index was reset under it. */
  private epoch = 0

  constructor() {
    this.index = new MiniSearch({
      // Include source/title so filename-only questions can retrieve their
      // chunks. Keep content separately for the stored projection returned to
      // callers.
      fields: ["searchText"],
      idField: "id",
      searchOptions: {
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
      const searchableMetadata = [
        projected.metadata.source,
        projected.metadata.title
      ]
        .filter(Boolean)
        .join(" ")
      const searchText = `${content} ${searchableMetadata}`.toLowerCase()
      this.index.add({
        id,
        searchText,
        timestamp: document.metadata.timestamp
      })
      this.documents.set(id, projected)
      this.indexedTextChars += searchText.length
      this.textLengths.set(id, searchText.length)
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
      filter?: (document: KeywordIndexDocument) => boolean
    } = {}
  ): KeywordSearchResult[] {
    if (!query.trim()) {
      return []
    }

    try {
      const results = this.index.search(query.toLowerCase(), {
        fuzzy: options.fuzzy ?? 0.2,
        prefix:
          (options.prefix ?? true)
            ? (term: string) => term.length >= MIN_PREFIX_TERM_LENGTH
            : false,
        combineWith: options.combineWith ?? "OR", // OR for better recall
        filter: (result) => {
          const document = this.documents.get(result.id)
          return document !== undefined && (options.filter?.(document) ?? true)
        }
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
          searchText: string
          timestamp: number
        })
        this.documents.delete(id)
        this.indexedTextChars -= this.textLengths.get(id) ?? 0
        this.textLengths.delete(id)
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
    this.textLengths.clear()
    this.indexedTextChars = 0
    this.epoch += 1
    logger.verbose("Keyword index cleared", "KeywordIndex")
  }

  /**
   * Get index statistics.
   *
   * `memorySizeMB` is an estimate from the running count of indexed characters
   * times `RESIDENT_BYTES_PER_INDEXED_CHAR`, the measured cost of MiniSearch's
   * term tree and postings. The earlier figure counted only the characters
   * themselves and reported about a fourteenth of what the index held.
   */
  getStats() {
    return {
      documentCount: this.index.documentCount,
      termCount: this.documents.size,
      memorySizeMB:
        (this.indexedTextChars * RESIDENT_BYTES_PER_INDEXED_CHAR) /
        (1024 * 1024)
    }
  }

  /**
   * Replace the index with the rows `readBatch` yields, one batch at a time.
   *
   * The caller pages by id (`afterId` is the last id of the previous batch), so
   * the build never holds more than one batch of full rows — each carries two
   * float arrays this index discards. A build abandons itself if `clear()` runs
   * underneath it, so a stale loop cannot refill an index that was reset.
   */
  async buildFromBatches(
    readBatch: (afterId: number | undefined) => Promise<VectorDocument[]>,
    onProgress?: (processed: number) => void
  ): Promise<void> {
    const startTime = performance.now()
    this.clear()
    const epoch = this.epoch
    let processed = 0
    let afterId: number | undefined
    for (;;) {
      const batch = await readBatch(afterId)
      if (this.epoch !== epoch) return
      if (batch.length === 0) break
      for (const doc of batch) {
        if (doc.id === undefined) continue
        this.addDocument(doc.id, doc.content, doc)
        processed++
        afterId = doc.id
      }
      onProgress?.(processed)
      await new Promise((resolve) => setTimeout(resolve, 0)) // Yield
    }
    logger.info("Keyword index built successfully", "KeywordIndex", {
      count: processed,
      duration: `${(performance.now() - startTime).toFixed(2)}ms`
    })
  }

  /** Build index from documents already in memory (tests, benchmarks). */
  async buildFromDocuments(
    documents: VectorDocument[],
    onProgress?: (current: number, total: number) => void
  ): Promise<void> {
    const BATCH_SIZE = 100
    let offset = 0
    await this.buildFromBatches(
      async () => documents.slice(offset, (offset += BATCH_SIZE)),
      (processed) => onProgress?.(processed, documents.length)
    )
  }
}

/** Export singleton instance */
export const keywordIndexManager = new KeywordIndexManager()
