import { beforeEach, describe, expect, it } from "vitest"
import { vectorDb } from "../db"
import { clearAllVectors, hasVectorsForEmbeddingModel } from "../storage"
import type { VectorDocument } from "../types"

const row = (embeddingModel?: string): VectorDocument => ({
  content: "text",
  embedding: [1, 0],
  metadata: {
    source: "test",
    type: "file",
    fileId: "file-1",
    timestamp: 1,
    ...(embeddingModel ? { embeddingModel } : {})
  }
})

beforeEach(async () => {
  await clearAllVectors()
})

describe("hasVectorsForEmbeddingModel", () => {
  it("treats an empty store as matching, since nothing indexed is stale", async () => {
    await expect(hasVectorsForEmbeddingModel("bge-m3")).resolves.toBe(true)
  })

  it("reports a store built by another model as not matching", async () => {
    await vectorDb.vectors.add(row("nomic-embed-text"))
    await expect(hasVectorsForEmbeddingModel("bge-m3")).resolves.toBe(false)
  })

  it("matches a row made by the model, the way search compares names", async () => {
    await vectorDb.vectors.add(row("nomic-embed-text"))
    await vectorDb.vectors.add(row("bge-m3"))
    await expect(hasVectorsForEmbeddingModel("bge-m3")).resolves.toBe(true)
    await expect(hasVectorsForEmbeddingModel(" bge-m3 ")).resolves.toBe(true)
  })
})
