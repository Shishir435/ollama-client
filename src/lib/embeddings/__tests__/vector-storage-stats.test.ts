import { beforeEach, describe, expect, it, vi } from "vitest"
import { vectorDb } from "../db"
import {
  clearAllVectors,
  deleteVectors,
  getStorageStats,
  estimateStorageSize,
  storeVector
} from "../storage"
import type { VectorDocument } from "../types"
import {
  addDocumentToVectorStorageStats,
  applyVectorStorageChanges,
  emptyVectorStorageStats,
  VECTOR_STORAGE_STATS_ID
} from "../vector-storage-stats"

const metadata: VectorDocument["metadata"] = {
  source: "test",
  type: "file",
  fileId: "file-1",
  timestamp: 1
}

beforeEach(async () => {
  await clearAllVectors()
  await vectorDb.embeddingState.clear()
  await vectorDb.embeddingRebuild.clear()
  await vectorDb.vectorStats.put(emptyVectorStorageStats())
})

describe("durable vector storage statistics", () => {
  it("builds totals from documents already stored during upgrade", () => {
    const legacy = [
      { content: "old one", embedding: [1, 0], metadata },
      {
        content: "old two",
        embedding: [0, 1],
        metadata: { ...metadata, type: "chat" as const }
      }
    ] satisfies VectorDocument[]
    const totals = emptyVectorStorageStats()

    for (const document of legacy)
      addDocumentToVectorStorageStats(totals, document)

    expect(totals).toEqual({
      id: VECTOR_STORAGE_STATS_ID,
      totalVectors: 2,
      totalBytes: legacy.reduce(
        (total, document) => total + estimateStorageSize(document),
        0
      ),
      byType: { file: 1, chat: 1 }
    })
  })

  it("uses UTF-8 byte lengths for document size estimates", () => {
    const document: VectorDocument = {
      content: "café 🌿",
      embedding: [1, 0],
      normalizedEmbedding: [1, 0],
      metadata,
      norm: 1
    }
    const expected =
      16 +
      new TextEncoder().encode(document.content).byteLength +
      new TextEncoder().encode(JSON.stringify(metadata)).byteLength +
      100

    expect(estimateStorageSize(document)).toBe(expected)
  })

  it("tracks inserts, updates, deletes, and clear without scanning vector rows", async () => {
    const id = await storeVector("first chunk", [1, 0], metadata)
    const before = (await vectorDb.vectors.get(id))!
    const after: VectorDocument = {
      ...before,
      content: "updated chunk with a longer body",
      metadata: { ...before.metadata, title: "updated" }
    }

    await vectorDb.transaction(
      "rw",
      vectorDb.vectors,
      vectorDb.vectorStats,
      async () => {
        await vectorDb.vectors.put(after)
        await applyVectorStorageChanges(vectorDb.vectorStats, [
          { before, after }
        ])
      }
    )

    const toArray = vi.spyOn(vectorDb.vectors, "toArray")
    const updatedStats = await getStorageStats()
    expect(toArray).not.toHaveBeenCalled()
    expect(updatedStats).toEqual({
      totalVectors: 1,
      totalSizeMB: estimateStorageSize(after) / (1024 * 1024),
      byType: { file: 1 }
    })
    toArray.mockRestore()

    expect(await deleteVectors({ fileId: "file-1" })).toBe(1)
    expect(await getStorageStats()).toEqual({
      totalVectors: 0,
      totalSizeMB: 0,
      byType: {}
    })

    await storeVector("second chunk", [0, 1], metadata)
    expect(await clearAllVectors()).toBe(1)
    expect(await vectorDb.vectorStats.get(VECTOR_STORAGE_STATS_ID)).toEqual(
      emptyVectorStorageStats()
    )
  })

  it("rolls back vector changes and byte totals together", async () => {
    const id = await storeVector("kept chunk", [1, 0], metadata)
    const before = (await vectorDb.vectors.get(id))!
    const priorStats = await vectorDb.vectorStats.get(VECTOR_STORAGE_STATS_ID)
    const after = { ...before, content: "should roll back" }

    await expect(
      vectorDb.transaction(
        "rw",
        vectorDb.vectors,
        vectorDb.vectorStats,
        async () => {
          await vectorDb.vectors.put(after)
          await applyVectorStorageChanges(vectorDb.vectorStats, [
            { before, after }
          ])
          throw new Error("abort the transaction")
        }
      )
    ).rejects.toThrow("abort the transaction")

    expect(await vectorDb.vectors.get(id)).toEqual(before)
    expect(await vectorDb.vectorStats.get(VECTOR_STORAGE_STATS_ID)).toEqual(
      priorStats
    )
  })
})
