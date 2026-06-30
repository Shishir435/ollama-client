import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const openDatabases: Array<{ close: () => void; delete: () => Promise<void> }> =
  []

const bootFreshVectorContext = async () => {
  vi.resetModules()
  const vectorStore = await import("@/lib/embeddings/vector-store")
  const { hnswIndexManager } = await import("@/lib/embeddings/hnsw-index")
  openDatabases.push(vectorStore.vectorDb)
  return { ...vectorStore, hnswIndexManager }
}

const clearVectorDatabase = async () => {
  const context = await bootFreshVectorContext()
  await context.vectorDb.delete()
  context.vectorDb.close()
  openDatabases.length = 0
}

beforeEach(clearVectorDatabase)

afterEach(async () => {
  for (const database of openDatabases) database.close()
  openDatabases.length = 0

  const cleanup = await bootFreshVectorContext()
  await cleanup.vectorDb.delete()
  cleanup.vectorDb.close()
  openDatabases.length = 0
})

describe("S4 - vector search survives a service-worker restart", () => {
  it("finds a persisted chunk after loading a fresh module graph", async () => {
    const embedding = [1, 0, 0, 0]
    const first = await bootFreshVectorContext()

    await first.storeVector("durable vector sentinel", embedding, {
      source: "restart-smoke.txt",
      type: "file",
      fileId: "restart-smoke",
      timestamp: Date.now()
    })
    await first.hnswIndexManager.buildIndex(undefined, embedding.length)

    expect(await first.vectorDb.vectors.count()).toBe(1)
    first.vectorDb.close()

    const second = await bootFreshVectorContext()
    const results = await second.searchSimilarVectors(embedding, {
      limit: 1,
      minSimilarity: 0.99,
      type: "file"
    })

    expect(results).toHaveLength(1)
    expect(results[0].document.content).toBe("durable vector sentinel")
    expect(results[0].document.metadata.fileId).toBe("restart-smoke")
  })
})
