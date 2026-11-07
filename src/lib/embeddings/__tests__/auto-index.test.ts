import { beforeEach, describe, expect, it, vi } from "vitest"
import { getPlasmoStoredValue } from "@/lib/plasmo-global-storage"
import {
  buildKeywordIndexFromExisting,
  ensureKeywordIndexBuilt
} from "../auto-index"
import { vectorDb } from "../db"
import { keywordIndexManager } from "../keyword-index"
import type { VectorDocument } from "../types"

const document = (id: number, content: string): VectorDocument => ({
  id,
  content,
  embedding: [1, 0],
  metadata: {
    source: "test",
    type: "file",
    timestamp: id
  }
})

beforeEach(async () => {
  await vectorDb.vectors.clear()
  keywordIndexManager.clear()
  vi.mocked(getPlasmoStoredValue).mockResolvedValue(true as never)
})

describe("keyword index initialization", () => {
  it("replaces an already-built in-memory index when force rebuild is requested", async () => {
    await vectorDb.vectors.add(document(1, "new birch document"))
    keywordIndexManager.addDocument(
      99,
      "stale moss document",
      document(99, "stale moss document")
    )

    await buildKeywordIndexFromExisting(undefined, true)

    expect(keywordIndexManager.search("stale moss")).toHaveLength(0)
    expect(
      keywordIndexManager.search("new birch").map((row) => row.id)
    ).toEqual([1])
  })

  it("does not materialize an empty vector table on repeated searches", async () => {
    const toArray = vi.spyOn(vectorDb.vectors, "toArray")

    await ensureKeywordIndexBuilt()

    expect(toArray).not.toHaveBeenCalled()
    toArray.mockRestore()
  })
})
