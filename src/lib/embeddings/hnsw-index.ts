import {
  DEFAULT_EMBEDDING_CONFIG,
  type EmbeddingConfig,
  STORAGE_KEYS
} from "@/lib/constants"
import { vectorDb } from "@/lib/embeddings/vector-store"
import { logger } from "@/lib/logger"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"

type AnnBackendType = "wasm-hnsw" | "ts-hnsw" | "bruteforce"

interface AnnBackendStats {
  count: number
  dimension: number | null
  memorySizeMB: number
  backend: AnnBackendType
}

interface AnnBackend {
  readonly backend: AnnBackendType
  initialize(dimension: number, config: EmbeddingConfig): Promise<void>
  buildIndex(
    vectors: Array<{ id: number; embedding: number[] }>,
    config: EmbeddingConfig
  ): Promise<void>
  addVector(id: number, embedding: number[]): Promise<void>
  search(
    queryEmbedding: number[],
    k: number,
    minSimilarity: number
  ): Promise<Array<{ id: number; distance: number }>>
  clear(): Promise<void>
  getStats(): AnnBackendStats
  isInitialized(): boolean
  isCompatibleDimension(dimension: number): boolean
}

/**
 * Local in-memory brute-force index for fast similarity search.
 */
class LocalVectorIndex {
  private vectors: Array<{ id: number; embedding: Float32Array }> = []
  private dimension: number | null = null

  initialize(dimension: number): void {
    this.dimension = dimension
    this.vectors = []
  }

  addVector(id: number, embedding: number[]): void {
    if (!this.dimension) {
      this.dimension = embedding.length
    }

    if (this.dimension !== embedding.length) {
      return
    }

    this.vectors.push({
      id,
      embedding: new Float32Array(embedding)
    })
  }

  buildIndex(vectors: Array<{ id: number; embedding: number[] }>): void {
    if (vectors.length === 0) {
      this.vectors = []
      this.dimension = null
      return
    }

    this.initialize(vectors[0].embedding.length)
    for (const vector of vectors) {
      this.addVector(vector.id, vector.embedding)
    }
  }

  search(
    queryEmbedding: number[],
    k: number,
    minSimilarity: number
  ): Array<{ id: number; distance: number }> {
    if (this.vectors.length === 0) {
      return []
    }

    if (this.dimension && queryEmbedding.length !== this.dimension) {
      return []
    }

    const queryVec = new Float32Array(queryEmbedding)
    const results: Array<{ id: number; similarity: number }> = []

    for (const vec of this.vectors) {
      const similarity = this.cosineSimilarity(queryVec, vec.embedding)

      if (similarity >= minSimilarity) {
        results.push({ id: vec.id, similarity })
      }
    }

    results.sort((a, b) => b.similarity - a.similarity)

    return results
      .slice(0, k)
      .map((r) => ({ id: r.id, distance: r.similarity }))
  }

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

  getStats(): AnnBackendStats {
    return {
      backend: "bruteforce",
      count: this.vectors.length,
      dimension: this.dimension,
      memorySizeMB:
        (this.vectors.length * (this.dimension || 0) * 4) / (1024 * 1024)
    }
  }

  getDimension(): number | null {
    return this.dimension
  }

  getCount(): number {
    return this.vectors.length
  }

  clear(): void {
    this.vectors = []
    this.dimension = null
  }
}

class WasmHnswBackend implements AnnBackend {
  readonly backend: AnnBackendType = "wasm-hnsw"
  private lib: Awaited<ReturnType<typeof import("hnswlib-wasm").loadHnswlib>> | null =
    null
  private index:
    | import("hnswlib-wasm").HierarchicalNSW
    | null = null
  private dimension: number | null = null
  private count = 0
  private filename = ""
  private persistTimer: NodeJS.Timeout | null = null

  private async loadLibrary() {
    if (this.lib) return this.lib
    const { loadHnswlib } = await import("hnswlib-wasm")
    this.lib = await loadHnswlib("IDBFS")
    return this.lib
  }

  private buildFilename(dimension: number) {
    return `hnsw-wasm-${dimension}.idx`
  }

  async initialize(
    dimension: number,
    _config: EmbeddingConfig
  ): Promise<void> {
    if (this.dimension === dimension && this.index) return
    const lib = await this.loadLibrary()
    this.dimension = dimension
    this.filename = this.buildFilename(dimension)
    this.index = new lib.HierarchicalNSW("cosine", dimension, this.filename)
  }

  async buildIndex(
    vectors: Array<{ id: number; embedding: number[] }>,
    config: EmbeddingConfig
  ): Promise<void> {
    if (vectors.length === 0) {
      this.clear()
      return
    }

    const dimension = vectors[0].embedding.length
    await this.initialize(dimension)
    const lib = await this.loadLibrary()
    try {
      await lib.EmscriptenFileSystemManager.syncFS(true, () => {})
    } catch (error) {
      logger.debug("Failed to sync IDBFS before build", "HNSWIndex", { error })
    }

    const maxElements = Math.max(
      vectors.length + 100,
      config.annMinVectors || 0,
      100
    )

    this.index?.initIndex(
      maxElements,
      config.hnswM,
      config.hnswEfConstruction,
      100
    )
    this.index?.setEfSearch(config.hnswEfSearch)

    for (const vector of vectors) {
      this.index?.addPoint(vector.embedding, vector.id, false)
    }

    this.count = vectors.length

    try {
      await this.index?.writeIndex(this.filename)
      await lib.EmscriptenFileSystemManager.syncFS(false, () => {})
    } catch (error) {
      logger.warn("Failed to persist WASM HNSW index", "HNSWIndex", {
        error
      })
    }
  }

  async addVector(id: number, embedding: number[]): Promise<void> {
    if (!this.index || this.dimension !== embedding.length) return
    this.index.addPoint(embedding, id, false)
    this.count += 1
    this.schedulePersist()
  }

  async search(
    queryEmbedding: number[],
    k: number,
    minSimilarity: number
  ): Promise<Array<{ id: number; distance: number }>> {
    if (!this.index || !this.dimension) return []
    if (queryEmbedding.length !== this.dimension) return []

    const results = this.index.searchKnn(queryEmbedding, k, undefined)
    return results.neighbors
      .map((id, idx) => {
        const distance = results.distances[idx]
        const similarity = 1 - distance
        return { id, distance: similarity }
      })
      .filter((r) => r.distance >= minSimilarity)
  }

  async clear(): Promise<void> {
    this.index = null
    this.dimension = null
    this.count = 0
  }

  getStats(): AnnBackendStats {
    return {
      backend: this.backend,
      count: this.count,
      dimension: this.dimension,
      memorySizeMB:
        (this.count * (this.dimension || 0) * 4) / (1024 * 1024)
    }
  }

  isInitialized(): boolean {
    return !!this.index && this.count > 0
  }

  isCompatibleDimension(dimension: number): boolean {
    return this.dimension === dimension
  }

  private schedulePersist() {
    if (!this.lib || !this.index) return
    if (this.persistTimer) return

    this.persistTimer = setTimeout(async () => {
      this.persistTimer = null
      try {
        await this.index?.writeIndex(this.filename)
        await this.lib?.EmscriptenFileSystemManager.syncFS(false, () => {})
      } catch (error) {
        logger.debug("Deferred HNSW persist failed", "HNSWIndex", { error })
      }
    }, 5000)
  }
}

class TsHnswBackend implements AnnBackend {
  readonly backend: AnnBackendType = "ts-hnsw"
  private index: import("hnsw").HNSWWithDB | null = null
  private dimension: number | null = null
  private count = 0
  private persistTimer: NodeJS.Timeout | null = null

  private buildDbName(dimension: number) {
    return `hnsw-ts-${dimension}`
  }

  async initialize(
    dimension: number,
    config: EmbeddingConfig = DEFAULT_EMBEDDING_CONFIG
  ): Promise<void> {
    if (this.dimension === dimension && this.index) return
    const { HNSWWithDB } = await import("hnsw")
    this.dimension = dimension
    this.index = await HNSWWithDB.create(
      config.hnswM,
      config.hnswEfConstruction,
      this.buildDbName(dimension)
    )
  }

  async buildIndex(
    vectors: Array<{ id: number; embedding: number[] }>,
    config: EmbeddingConfig
  ): Promise<void> {
    if (vectors.length === 0) {
      await this.clear()
      return
    }

    const dimension = vectors[0].embedding.length
    await this.initialize(dimension, config)

    if (!this.index) return

    await this.index.buildIndex(
      vectors.map((vector) => ({
        id: vector.id,
        vector: vector.embedding
      }))
    )
    this.count = vectors.length
    await this.index.saveIndex()
  }

  async addVector(id: number, embedding: number[]): Promise<void> {
    if (!this.index || this.dimension !== embedding.length) return
    await this.index.addPoint(id, embedding)
    this.count += 1
    this.schedulePersist()
  }

  async search(
    queryEmbedding: number[],
    k: number,
    minSimilarity: number
  ): Promise<Array<{ id: number; distance: number }>> {
    if (!this.index) return []
    const results = this.index.searchKNN(queryEmbedding, k)
    return results
      .map((result) => ({ id: result.id, distance: result.score }))
      .filter((r) => r.distance >= minSimilarity)
  }

  async clear(): Promise<void> {
    if (this.index) {
      await this.index.deleteIndex()
    }
    this.index = null
    this.dimension = null
    this.count = 0
  }

  getStats(): AnnBackendStats {
    return {
      backend: this.backend,
      count: this.count,
      dimension: this.dimension,
      memorySizeMB:
        (this.count * (this.dimension || 0) * 4) / (1024 * 1024)
    }
  }

  isInitialized(): boolean {
    return !!this.index && this.count > 0
  }

  isCompatibleDimension(dimension: number): boolean {
    return this.dimension === dimension
  }

  private schedulePersist() {
    if (!this.index || this.persistTimer) return
    this.persistTimer = setTimeout(async () => {
      this.persistTimer = null
      try {
        await this.index?.saveIndex()
      } catch (error) {
        logger.debug("Deferred TS HNSW persist failed", "HNSWIndex", { error })
      }
    }, 5000)
  }
}

class HNSWIndexManager {
  private localIndex: LocalVectorIndex = new LocalVectorIndex()
  private wasmBackend = new WasmHnswBackend()
  private tsBackend = new TsHnswBackend()
  private isBuilding: boolean = false
  private buildProgress: number = 0

  private async getConfig(): Promise<EmbeddingConfig> {
    const stored = await plasmoGlobalStorage.get<EmbeddingConfig>(
      STORAGE_KEYS.EMBEDDINGS.CONFIG
    )
    return {
      ...DEFAULT_EMBEDDING_CONFIG,
      ...stored
    }
  }

  private resolveBackend(config: EmbeddingConfig): AnnBackendType {
    return config.annBackend || "wasm-hnsw"
  }

  private getBackendInstance(config: EmbeddingConfig): AnnBackend | null {
    const backend = this.resolveBackend(config)
    if (backend === "wasm-hnsw") return this.wasmBackend
    if (backend === "ts-hnsw") return this.tsBackend
    return null
  }

  async initialize(dimension: number): Promise<void> {
    const config = await this.getConfig()
    const backend = this.getBackendInstance(config)
    if (backend) {
      await backend.initialize(dimension, config)
      return
    }
    this.localIndex.initialize(dimension)
  }

  async buildIndex(
    onProgress?: (current: number, total: number) => void,
    targetDimension?: number
  ): Promise<void> {
    if (this.isBuilding) {
      logger.warn("Vector Index build already in progress", "HNSWIndex")
      return
    }

    this.isBuilding = true
    this.buildProgress = 0

    try {
      logger.info("Starting vector index build", "HNSWIndex")
      const startTime = performance.now()

      const allVectors = await vectorDb.vectors.toArray()
      const filteredVectors =
        targetDimension !== undefined
          ? allVectors.filter(
              (vector) => vector.embedding.length === targetDimension
            )
          : allVectors

      if (filteredVectors.length === 0) {
        logger.info("No vectors to index", "HNSWIndex")
        this.localIndex.clear()
        this.isBuilding = false
        return
      }

      const dimension = targetDimension ?? filteredVectors[0].embedding.length
      const config = await this.getConfig()
      const backend = this.getBackendInstance(config)

      const vectorPayload = filteredVectors
        .filter((vector) => vector.id !== undefined)
        .map((vector) => ({
          id: vector.id as number,
          embedding: vector.embedding
        }))

      if (backend) {
        try {
          await backend.buildIndex(vectorPayload, config)
        } catch (error) {
          if (backend.backend === "wasm-hnsw") {
            logger.warn(
              "WASM HNSW build failed, falling back to TS backend",
              "HNSWIndex",
              { error }
            )
            await this.tsBackend.buildIndex(vectorPayload, config)
          } else {
            throw error
          }
        }
      } else {
        this.localIndex.buildIndex(vectorPayload)
      }

      this.buildProgress = 1
      onProgress?.(vectorPayload.length, vectorPayload.length)

      const duration = performance.now() - startTime
      logger.info("Vector Index built successfully", "HNSWIndex", {
        backend: backend?.backend ?? "bruteforce",
        count: vectorPayload.length,
        dimension,
        targetDimension,
        duration: `${duration.toFixed(2)}ms`
      })
    } catch (error) {
      logger.error("Vector Index build failed", "HNSWIndex", { error })
      throw error
    } finally {
      this.isBuilding = false
      this.buildProgress = 0
    }
  }

  async addVector(id: number, embedding: number[]): Promise<void> {
    const config = await this.getConfig()
    const backend = this.getBackendInstance(config)
    try {
      if (backend?.isInitialized()) {
        await backend.addVector(id, embedding)
      } else if (backend?.backend === "wasm-hnsw" && this.tsBackend.isInitialized()) {
        await this.tsBackend.addVector(id, embedding)
      } else if (!backend) {
        this.localIndex.addVector(id, embedding)
      }
    } catch (error) {
      logger.error("Failed to add vector to index", "HNSWIndex", { error })
    }
  }

  async search(
    queryEmbedding: number[],
    k: number = 10
  ): Promise<Array<{ id: number; distance: number }>> {
    const config = await this.getConfig()
    const minSimilarity = config.defaultMinSimilarity
    const backend = this.getBackendInstance(config)
    if (backend?.isInitialized()) {
      return backend.search(queryEmbedding, k, minSimilarity)
    }
    if (backend?.backend === "wasm-hnsw" && this.tsBackend.isInitialized()) {
      return this.tsBackend.search(queryEmbedding, k, minSimilarity)
    }
    return this.localIndex.search(queryEmbedding, k, minSimilarity)
  }

  async clearIndex(): Promise<void> {
    await this.wasmBackend.clear()
    await this.tsBackend.clear()
    this.localIndex.clear()
    logger.verbose("Vector Index cleared", "HNSWIndex")
  }

  getStats(): {
    isInitialized: boolean
    dimension: number | null
    numElements: number
    isBuilding: boolean
    buildProgress: number
    memorySizeMB: number
    backend: AnnBackendType
  } {
    const stats =
      this.wasmBackend.isInitialized()
        ? this.wasmBackend.getStats()
        : this.tsBackend.isInitialized()
          ? this.tsBackend.getStats()
          : this.localIndex.getStats()

    return {
      isInitialized: stats.count > 0,
      dimension: stats.dimension,
      numElements: stats.count,
      isBuilding: this.isBuilding,
      buildProgress: this.buildProgress,
      memorySizeMB: stats.memorySizeMB,
      backend: stats.backend
    }
  }

  async shouldUseHNSW(vectorCount: number): Promise<boolean> {
    const config = await this.getConfig()

    if (!config.useHNSW) {
      return false
    }

    const minVectors = config.annMinVectors ?? config.hnswMinVectors ?? 0
    if (vectorCount < minVectors) {
      return false
    }

    const backend = this.getBackendInstance(config)
    if (!backend) return false

    if (backend.isInitialized()) return true
    if (backend.backend === "wasm-hnsw") {
      return this.tsBackend.isInitialized()
    }

    return false
  }

  isCompatibleDimension(queryDimension: number): boolean {
    if (this.wasmBackend.isInitialized()) {
      return this.wasmBackend.isCompatibleDimension(queryDimension)
    }
    if (this.tsBackend.isInitialized()) {
      return this.tsBackend.isCompatibleDimension(queryDimension)
    }
    const dimension = this.localIndex.getDimension()
    if (!dimension) return false
    return dimension === queryDimension
  }
}

export const hnswIndexManager = new HNSWIndexManager()
