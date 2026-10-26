import { DEFAULT_EMBEDDING_CONFIG } from "@/lib/constants"
import { searchCache } from "@/lib/embeddings/cache"
import { resetEmbeddingConfigCache } from "@/lib/embeddings/config"
import { vectorDb } from "@/lib/embeddings/db"
import { hnswIndexManager } from "@/lib/embeddings/hnsw-index"
import { keywordIndexManager } from "@/lib/embeddings/keyword-index"
import { normalizeVector } from "@/lib/embeddings/math"
import { initialNativeIndexState } from "@/lib/embeddings/native/state"
import { searchHybrid, searchSimilarVectors } from "@/lib/embeddings/search"
import {
  clearAllVectors,
  deleteVectors,
  getStorageStats,
  storeVector
} from "@/lib/embeddings/storage"
import type { VectorDocument } from "@/lib/embeddings/types"
import { VectorStorageFullError } from "@/lib/embeddings/vector-storage-full"
import {
  addDocumentToVectorStorageStats,
  emptyVectorStorageStats
} from "@/lib/embeddings/vector-storage-stats"
import { writeSetting } from "@/lib/storage/setting-access"
import { SETTINGS } from "@/lib/storage/settings"

/** Fixed vectors isolate search/IDB cost from inference; quality uses real local inference. */
const fixture = (index: number): VectorDocument => {
  const embedding = Array.from({ length: 384 }, (_, dimension) =>
    Math.sin((index + 1) * (dimension + 1) * 0.17)
  )
  const { normalized, norm } = normalizeVector(embedding)
  return {
    id: index + 1,
    content: `Synthetic retrieval record ${index}. ${"Local evidence for the cobalt project. ".repeat(50)}`,
    embedding,
    normalizedEmbedding: normalized,
    norm,
    metadata: {
      type: "file",
      source: "Synthetic corpus",
      fileId: `file-${index % 100}`,
      timestamp: index + 1
    }
  }
}

const heap = (): number | null =>
  (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory
    ?.usedJSHeapSize ?? null

const measure = async (run: () => Promise<unknown>, samples: number) => {
  const times: number[] = []
  for (let index = 0; index < samples; index++) {
    searchCache.clear()
    const start = performance.now()
    await run()
    times.push(performance.now() - start)
  }
  const sorted = [...times].sort((a, b) => a - b)
  return {
    samplesMs: times,
    medianMs: sorted[Math.floor(samples / 2)],
    p95Ms: sorted[Math.ceil(samples * 0.95) - 1]
  }
}

const configure = async (useHNSW: boolean, maxStorageSize = 100) => {
  await writeSetting(SETTINGS.EMBEDDING_CONFIG, {
    ...DEFAULT_EMBEDDING_CONFIG,
    useHNSW,
    hnswAutoRebuild: false,
    annMinVectors: 1,
    annBackend: "ts-hnsw",
    maxStorageSize,
    maxEmbeddingsPerFile: 1000,
    autoCleanup: false,
    defaultMinSimilarity: 0
  })
  resetEmbeddingConfigCache()
}

/** Destructive fixture runner: only call in a disposable browser profile. No content is returned. */
export const runRetrievalBenchmark = async (
  sizes: number[],
  samples: number
) => {
  if (
    !sizes.length ||
    sizes.some(
      (size) => !Number.isInteger(size) || size < 100 || size > 20000
    ) ||
    !Number.isInteger(samples) ||
    samples < 1 ||
    samples > 100
  )
    throw new Error("Invalid benchmark bounds")
  const runs = []
  for (const size of sizes) {
    await configure(false)
    await clearAllVectors()
    await vectorDb.embeddingState.put({
      ...initialNativeIndexState,
      mode: "external"
    })
    const heapBefore = heap()
    const rows = Array.from({ length: size }, (_, index) => fixture(index))
    const stats = emptyVectorStorageStats()
    for (const row of rows) addDocumentToVectorStorageStats(stats, row)
    const start = performance.now()
    await vectorDb.transaction(
      "rw",
      vectorDb.vectors,
      vectorDb.vectorStats,
      async () => {
        await vectorDb.vectors.bulkPut(rows)
        await vectorDb.vectorStats.put(stats)
      }
    )
    const seedMs = performance.now() - start
    const query = rows[0].embedding
    const vectorPayloadBytes = size * 384 * 4 * 2
    rows.length = 0
    const heapAfterSeed = heap()
    const options = { limit: 10, minSimilarity: -1 }
    await searchSimilarVectors(query, options)
    const bruteForce = await measure(
      () => searchSimilarVectors(query, options),
      samples
    )
    const scoped = await measure(
      () => searchSimilarVectors(query, { ...options, fileId: "file-0" }),
      samples
    )
    const exactScopedIds = (
      await searchSimilarVectors(query, { ...options, fileId: "file-0" })
    ).map((result) => result.document.id)
    const storageStats = await measure(() => getStorageStats(), samples)
    const ingestionQuotaAccounting = await measure(
      () =>
        storeVector(
          "Synthetic admission",
          query.map((value) => -value),
          {
            type: "file",
            source: "Synthetic admission",
            fileId: "admission",
            timestamp: Date.now()
          }
        ),
      samples
    )
    const keywordStart = performance.now()
    await keywordIndexManager.buildFromDocuments(
      await vectorDb.vectors.toArray()
    )
    const keywordBuildMs = performance.now() - keywordStart
    const keyword = await measure(
      async () =>
        keywordIndexManager.search("cobalt project", {
          limit: 10,
          filter: (document) => document.metadata.fileId === "file-0"
        }),
      samples
    )
    const hybrid = await measure(
      () =>
        searchHybrid("cobalt project", query, { ...options, fileId: "file-0" }),
      samples
    )
    searchCache.clear()
    const exactIds = (await searchSimilarVectors(query, options)).map(
      (result) => result.document.id
    )
    await configure(true)
    const hnswStart = performance.now()
    const previousRandom = Math.random
    let seed = 731
    Math.random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      return seed / 4294967296
    }
    try {
      await hnswIndexManager.buildIndex(undefined, 384)
    } finally {
      Math.random = previousRandom
    }
    const hnswBuildMs = performance.now() - hnswStart
    const hnswStats = hnswIndexManager.getStats()
    const hnsw = await measure(
      () => searchSimilarVectors(query, options),
      samples
    )
    const hnswScoped = await measure(
      () => searchSimilarVectors(query, { ...options, fileId: "file-0" }),
      samples
    )
    const graphScopedIds =
      searchCache
        .values()
        .next()
        .value?.results.map((result) => result.document.id) ?? []
    const scopedRecallAt10 =
      graphScopedIds.filter((id) => exactScopedIds.includes(id)).length /
      exactScopedIds.length
    searchCache.clear()
    const approximateIds = (await searchSimilarVectors(query, options)).map(
      (result) => result.document.id
    )
    const recallAt10 =
      approximateIds.filter((id) => exactIds.includes(id)).length /
      exactIds.length
    const retainedResults =
      searchCache.values().next().value?.results.length ?? 0
    const heapAfterIndexes = heap()
    const beforeDeletion = await getStorageStats()
    const deleteStart = performance.now()
    const deleted = await deleteVectors({ fileId: "file-0" })
    const deletionMs = performance.now() - deleteStart
    const afterDeletion = await getStorageStats()
    // Half of what is stored, so the attempt is refused at every corpus size.
    await configure(false, Math.max(0.001, afterDeletion.totalSizeMB / 2))
    const quotaStart = performance.now()
    const refused = await storeVector("Over the limit", query, {
      type: "file",
      source: "Over the limit",
      fileId: "over-limit",
      timestamp: Date.now()
    }).then(
      () => false,
      (error: unknown) => error instanceof VectorStorageFullError
    )
    const quotaRefusalMs = performance.now() - quotaStart
    runs.push({
      size,
      dimension: 384,
      scopedCount: size / 100,
      samples,
      seedMs,
      vectorPayloadBytes,
      estimatedStorageBytes: stats.totalBytes,
      heapBefore,
      heapAfterSeed,
      heapAfterIndexes,
      bruteForce,
      scoped,
      storageStats,
      ingestionQuotaAccounting,
      keywordBuildMs,
      keyword,
      hybrid,
      hnswBuildMs,
      hnswStats,
      recallAt10,
      scopedRecallAt10,
      exactScopedIds,
      graphScopedIds,
      exactTop10Ids: exactIds,
      graphTop10Ids: approximateIds,
      hnsw,
      hnswScoped,
      retainedResults,
      deleted,
      deletionMs,
      beforeDeletion,
      afterDeletion,
      quotaRefusalMs,
      quotaRefused: refused,
      afterQuota: await getStorageStats(),
      keywordStats: keywordIndexManager.getStats()
    })
  }
  await configure(false)
  await clearAllVectors()
  return {
    environment: "real extension IndexedDB; synthetic 384-dimensional vectors",
    memoryMetric:
      "usedJSHeapSize when supported; sampled without GC, excludes worker WASM/process memory",
    runs
  }
}
