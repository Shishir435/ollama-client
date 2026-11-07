import { beforeEach, describe, expect, it, vi } from "vitest"
import { emptyVectorStorageStats } from "@/lib/embeddings/vector-storage-stats"
import { removeDuplicateVectors, vectorDb } from "../vector-store"

vi.mock("@/lib/embeddings/keyword-index", () => ({
  keywordIndexManager: {
    clear: vi.fn(),
    addDocument: vi.fn(),
    removeDocument: vi.fn()
  }
}))
vi.mock("@/lib/plasmo-global-storage", () => ({
  getPlasmoStoredValue: vi.fn().mockResolvedValue({})
}))

const row = (content: string, sessionId: string) => ({
  content,
  embedding: [0.1, 0.2, 0.3],
  metadata: { type: "chat", sessionId, timestamp: 1 }
})

describe("removeDuplicateVectors", () => {
  beforeEach(async () => {
    await vectorDb.vectors.clear()
    await vectorDb.vectorStats.put(emptyVectorStorageStats())
  })

  it("keeps the oldest of each duplicate without loading the whole table", async () => {
    await vectorDb.vectors.bulkAdd([
      row("same", "s1"),
      row("other", "s1"),
      row("same", "s1"),
      row("same", "s2")
    ] as never)
    const toArray = vi.spyOn(vectorDb.vectors, "toArray")

    const result = await removeDuplicateVectors()

    expect(toArray).not.toHaveBeenCalled()
    expect(result).toEqual({ deleted: 1, kept: 3 })
    const left = await vectorDb.vectors.orderBy("id").primaryKeys()
    expect(left).toHaveLength(3)
    expect(left).not.toContain(3)
  })
})
