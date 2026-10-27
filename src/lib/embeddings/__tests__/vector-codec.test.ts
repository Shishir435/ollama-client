import { beforeEach, describe, expect, it } from "vitest"
import { vectorDb } from "../db"
import {
  attachLegacyEmbedding,
  encodeVectorDocument,
  isLegacyVectorRow,
  vectorDimension
} from "../vector-codec"
import { estimateVectorStorageSize } from "../vector-storage-stats"

const metadata = { source: "s", type: "file" as const, timestamp: 1 }

beforeEach(async () => {
  await vectorDb.vectors.clear()
})

describe("encodeVectorDocument", () => {
  it("keeps the unit vector as float32 and drops the raw vector", () => {
    const stored = encodeVectorDocument({
      content: "c",
      embedding: [3, 4],
      metadata
    })

    expect(stored).not.toHaveProperty("embedding")
    expect(stored.normalizedEmbedding).toBeInstanceOf(Float32Array)
    expect(Array.from(stored.normalizedEmbedding)).toEqual([
      Math.fround(0.6),
      Math.fround(0.8)
    ])
    expect(stored.norm).toBe(5)
  })

  it("reuses a normalization the caller already computed", () => {
    const stored = encodeVectorDocument({
      content: "c",
      embedding: [3, 4],
      normalizedEmbedding: [1, 0],
      norm: 9,
      metadata
    })

    expect(Array.from(stored.normalizedEmbedding)).toEqual([1, 0])
    expect(stored.norm).toBe(9)
  })

  it("is idempotent on an already stored row", () => {
    const once = encodeVectorDocument({
      content: "c",
      embedding: [3, 4],
      metadata
    })
    expect(encodeVectorDocument(once).normalizedEmbedding).toBe(
      once.normalizedEmbedding
    )
  })
})

describe("read hook", () => {
  it("rebuilds the raw vector from the unit vector and norm on access", async () => {
    const id = await vectorDb.vectors.add(
      encodeVectorDocument({ content: "c", embedding: [3, 4], metadata })
    )

    const row = await vectorDb.vectors.get(id)

    expect(row?.embedding[0]).toBeCloseTo(3, 5)
    expect(row?.embedding[1]).toBeCloseTo(4, 5)
  })

  it("does not write the rebuilt vector back when a row is spread and put", async () => {
    const id = await vectorDb.vectors.add(
      encodeVectorDocument({ content: "c", embedding: [3, 4], metadata })
    )
    const row = (await vectorDb.vectors.get(id))!
    void row.embedding

    await vectorDb.vectors.put({ ...row, content: "edited" })

    const raw = await vectorDb.vectors.toCollection().first()
    expect(Object.keys(raw ?? {})).not.toContain("embedding")
    expect(raw?.content).toBe("edited")
  })

  it("passes a missing row through", async () => {
    expect(attachLegacyEmbedding(undefined as never)).toBeUndefined()
    expect(await vectorDb.vectors.get(999)).toBeUndefined()
    expect(await vectorDb.vectors.bulkGet([998, 999])).toEqual([
      undefined,
      undefined
    ])
  })

  it("leaves a row in the earlier shape untouched", async () => {
    const id = await vectorDb.vectors.add({
      content: "old",
      embedding: [1, 2],
      normalizedEmbedding: [0.5, 0.5],
      norm: 2,
      metadata
    })

    const row = await vectorDb.vectors.get(id)

    expect(row?.embedding).toEqual([1, 2])
    expect(isLegacyVectorRow(row!)).toBe(true)
  })
})

describe("vectorDimension", () => {
  it("reads either shape", () => {
    expect(vectorDimension({ normalizedEmbedding: new Float32Array(4) })).toBe(
      4
    )
    expect(vectorDimension({ embedding: [1, 2, 3] })).toBe(3)
    expect(vectorDimension({})).toBe(0)
  })
})

describe("estimateVectorStorageSize", () => {
  it("counts one 4-byte vector for a float32 row and both for an earlier row", () => {
    const base = { content: "", metadata }
    const float32 = estimateVectorStorageSize({
      ...base,
      normalizedEmbedding: new Float32Array(10)
    })
    const legacy = estimateVectorStorageSize({
      ...base,
      embedding: Array.from({ length: 10 }, () => 0),
      normalizedEmbedding: Array.from({ length: 10 }, () => 0)
    })

    expect(legacy - float32).toBe(10 * 4)
  })
})
