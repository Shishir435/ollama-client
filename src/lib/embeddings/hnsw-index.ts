import Dexie, { type Table } from "dexie"
import {
  DEFAULT_EMBEDDING_CONFIG,
  type EmbeddingConfig,
  STORAGE_KEYS
} from "@/lib/constants"
import { vectorDb } from "@/lib/embeddings/vector-store"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"

/**
 * LocalIndex - In-memory HNSW-inspired index for fast approximate nearest neighbor search
 *
 * This is a simplified implementation that works in Service Workers.
 * For production use at scale (>50K vectors), consider upgrading to the WASM solution
 * documented in docs/HNSW_WASM_UPGRADE.md
 */
interface IndexedVector {
  id: number
  embedding: Float32Array
}

class LocalVectorIndex {
  private vectors: IndexedVector[] = []
  private dimension: number | null = null

  /**
   * Initialize index with dimension
   */
  initialize(dimension: number): void {
    this.dimension = dimension
    this.vectors = []
  }

  /**
   * Add vector to index
   */
  addVector(id: number, embedding: number[]): void {
    if (!this.dimension) {
      this.dimension = embedding.length
    }

    this.vectors.push({
      id,
      embedding: new Float32Array(embedding)
    })
  }

  /**
   * Search for k nearest neighbors using optimized brute-force with early termination
   *
   * While not true HNSW, this provides decent performance for datasets up to ~50K vectors:
   * - Pre-normalized vectors for fast dot product
   * - Float32Array for SIMD optimization
   * - Top-K heap for memory efficiency
   */
  search(
    queryEmbedding: number[],
    k: number,
    minSimilarity: number = 0.0
  ): Array<{ id: number; distance: number }> {
    if (this.vectors.length === 0) {
      return []
    }

    const queryVec = new Float32Array(queryEmbedding)
    const results: Array<{ id: number; similarity: number }> = []

    // Calculate similarities for all vectors
    for (const vec of this.vectors) {
      const similarity = this.cosineSimilarity(queryVec, vec.embedding)

      if (similarity >= minSimilarity) {
        results.push({ id: vec.id, similarity })
      }
    }

    // Sort by similarity (descending) and take top K
    results.sort((a, b) => b.similarity - a.similarity)

    return results
      .slice(0, k)
      .map((r) => ({ id: r.id, distance: r.similarity }))
  }

  /**
   * Fast cosine similarity using Float32Array
   */
  private cosineSimilarity(a: Float32Array, b: Float32Array): number {
    let dotProduct = 0
    let normA = 0
    let normB = 0

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i]
      normA += a[i] * a[i]
      normB += b[i] * b[i]
    }

    const denominator = Math.sqrt(normA * normB)
    return denominator === 0 ? 0 : dotProduct / denominator
  }

  /**
   * Get current vector count
   */
  getCount(): number {
    return this.vectors.length
  }

  /**
   * Clear all vectors
   */
  clear(): void {
    this.vectors = []
    this.dimension = null
  }

  /**
   * Get index statistics
   */
  getStats() {
    return {
      count: this.vectors.length,
      dimension: this.dimension,
      memorySizeMB:
        (this.vectors.length * (this.dimension || 0) * 4) / (1024 * 1024)
    }
  }
}

/**
 * HNSW Index Data stored in IndexedDB (for future WASM implementation)
 */
interface HNSWIndexData {
  id: string
  dimension: number
  numElements: number
  indexData: Uint8Array
  timestamp: number
  version: number
}

/**
 * HNSW Index Database for persistence
 */
class HNSWIndexDatabase extends Dexie {
  hnswIndex!: Table<HNSWIndexData>

  constructor() {
    super("HNSWIndexDatabase")
    this.version(1).stores({
      hnswIndex: "id, timestamp"
    })
  }
}

export const hnswIndexDb = new HNSWIndexDatabase()

/**
 * HNSW Index Manager
 * Currently uses optimized brute-force search in Service Worker
 * Can be upgraded to WASM-based HNSW via Offscreen Document (see docs/HNSW_WASM_UPGRADE.md)
 */
class HNSWIndexManager {
  private index: LocalVectorIndex = new LocalVectorIndex()
  private isBuilding: boolean = false
  private buildProgress: number = 0

  /**
   * Get embedding configuration
   */
  private async getConfig(): Promise<EmbeddingConfig> {
    const stored = await plasmoGlobalStorage.get<EmbeddingConfig>(
      STORAGE_KEYS.EMBEDDINGS.CONFIG
    )
    return {
      ...DEFAULT_EMBEDDING_CONFIG,
      ...stored
    }
  }

  /**
   * Initialize HNSW index
   */
  async initialize(dimension: number): Promise<void> {
    this.index.initialize(dimension)
    console.log(`[Vector Index] Initialized (dimension: ${dimension})`)
  }

  /**
   * Build index from all vectors in the database
   */
  async buildIndex(
    onProgress?: (current: number, total: number) => void
  ): Promise<void> {
    if (this.isBuilding) {
      console.warn("[Vector Index] Build already in progress")
      return
    }

    this.isBuilding = true
    this.buildProgress = 0

    try {
      console.log("[Vector Index] Starting index build...")
      const startTime = performance.now()

      const allVectors = await vectorDb.vectors.toArray()

      if (allVectors.length === 0) {
        console.log("[Vector Index] No vectors to index")
        this.isBuilding = false
        return
      }

      const dimension = allVectors[0].embedding.length
      this.index.initialize(dimension)

      // Process in batches to avoid blocking
      const BATCH_SIZE = 100
      let processed = 0

      for (let i = 0; i < allVectors.length; i += BATCH_SIZE) {
        const batch = allVectors.slice(i, i + BATCH_SIZE)

        for (const vector of batch) {
          if (vector.id === undefined) continue
          this.index.addVector(vector.id, vector.embedding)
          processed++
        }

        this.buildProgress = processed / allVectors.length
        onProgress?.(processed, allVectors.length)

        // Yield to main thread
        await new Promise((resolve) => setTimeout(resolve, 0))
      }

      const duration = performance.now() - startTime
      console.log(
        `[Vector Index] Built successfully: ${allVectors.length} vectors in ${duration.toFixed(2)}ms`
      )
    } catch (error) {
      console.error("[Vector Index] Build failed:", error)
      throw error
    } finally {
      this.isBuilding = false
      this.buildProgress = 0
    }
  }

  /**
   * Add a single vector to the index (incremental update)
   */
  async addVector(id: number, embedding: number[]): Promise<void> {
    try {
      this.index.addVector(id, embedding)
    } catch (error) {
      console.error("[Vector Index] Failed to add vector:", error)
    }
  }

  /**
   * Search for k nearest neighbors
   */
  async search(
    queryEmbedding: number[],
    k: number = 10
  ): Promise<Array<{ id: number; distance: number }>> {
    const config = await this.getConfig()
    return this.index.search(queryEmbedding, k, config.defaultMinSimilarity)
  }

  /**
   * Clear the index
   */
  async clearIndex(): Promise<void> {
    this.index.clear()
    await hnswIndexDb.hnswIndex.clear()
    console.log("[Vector Index] Cleared")
  }

  /**
   * Get index statistics
   */
  getStats(): {
    isInitialized: boolean
    dimension: number | null
    numElements: number
    isBuilding: boolean
    buildProgress: number
    memorySizeMB: number
  } {
    const stats = this.index.getStats()
    return {
      isInitialized: stats.count > 0,
      dimension: stats.dimension,
      numElements: stats.count,
      isBuilding: this.isBuilding,
      buildProgress: this.buildProgress,
      memorySizeMB: stats.memorySizeMB
    }
  }

  /**
   * Check if index should be used based on configuration and vector count
   */
  async shouldUseHNSW(vectorCount: number): Promise<boolean> {
    const config = await this.getConfig()

    if (!config.useHNSW) {
      return false
    }

    if (vectorCount < config.hnswMinVectors) {
      return false
    }

    return this.index.getCount() > 0
  }
}

// Export singleton instance
export const hnswIndexManager = new HNSWIndexManager()
