import { beforeEach, describe, expect, it, vi } from "vitest"
import { vectorDb } from "@/lib/embeddings/db"
import { encodeVectorDocument } from "@/lib/embeddings/vector-codec"
import {
  addDocumentToVectorStorageStats,
  emptyVectorStorageStats,
  VECTOR_STORAGE_STATS_ID
} from "@/lib/embeddings/vector-storage-stats"
import { runVectorFormatMigration } from "../vector-format-migration"

const stored = new Map<string, unknown>()

vi.mock("@/lib/abortable-delay", () => ({
  abortableDelay: vi.fn().mockResolvedValue(undefined)
}))

vi.mock("@/lib/plasmo-global-storage", () => ({
  getPlasmoStoredValue: vi.fn(async (key: string) => stored.get(key)),
  setPlasmoStoredValue: vi.fn(async (key: string, value: unknown) => {
    stored.set(key, value)
  })
}))

const metadata = { source: "s", type: "file" as const, timestamp: 1 }

const legacyRow = (index: number) => ({
  content: `legacy ${index}`,
  embedding: [3, 4],
  normalizedEmbedding: [0.6, 0.8],
  norm: 5,
  metadata
})

/** Seeds rows the way they were saved before the float32 format, with totals. */
const seedLegacy = async (count: number) => {
  const rows = Array.from({ length: count }, (_, index) => legacyRow(index))
  await vectorDb.vectors.bulkAdd(rows)
  const totals = emptyVectorStorageStats()
  rows.forEach((row) => addDocumentToVectorStorageStats(totals, row))
  await vectorDb.vectorStats.put(totals)
  return totals
}

beforeEach(async () => {
  stored.clear()
  await vectorDb.vectors.clear()
  await vectorDb.vectorStats.clear()
})

describe("runVectorFormatMigration", () => {
  it("rewrites every earlier row to float32 across several batches", async () => {
    await seedLegacy(450)

    await runVectorFormatMigration()

    const rows = await vectorDb.vectors.toArray()
    expect(rows).toHaveLength(450)
    expect(
      rows.every((row) => row.normalizedEmbedding instanceof Float32Array)
    ).toBe(true)
    expect(rows[0].embedding[0]).toBeCloseTo(3, 5)
    expect(rows[0].embedding[1]).toBeCloseTo(4, 5)
  })

  it("moves the storage totals by exactly what the rewrite saved", async () => {
    const before = await seedLegacy(10)

    await runVectorFormatMigration()

    const after = await vectorDb.vectorStats.get(VECTOR_STORAGE_STATS_ID)
    // Each row drops the 2-float raw vector: 2 floats * 4 bytes.
    expect(before.totalBytes - (after?.totalBytes ?? 0)).toBe(10 * 2 * 4)
    expect(after?.totalVectors).toBe(10)
  })

  it("leaves rows already in the new shape and mixed stores alone", async () => {
    await seedLegacy(3)
    const id = await vectorDb.vectors.add(
      encodeVectorDocument({
        content: "new",
        embedding: [1, 0],
        metadata
      })
    )

    await runVectorFormatMigration()

    const row = await vectorDb.vectors.get(id)
    expect(row?.content).toBe("new")
    expect(await vectorDb.vectors.count()).toBe(4)
  })

  it("skips the scan once it has completed", async () => {
    await seedLegacy(2)
    await runVectorFormatMigration()
    await vectorDb.vectors.add(legacyRow(99))

    await runVectorFormatMigration()

    const last = (await vectorDb.vectors.toArray()).at(-1)
    expect(last?.normalizedEmbedding).toBeInstanceOf(Array)
  })

  it("finishes the rest after being cut short", async () => {
    await seedLegacy(450)
    const controller = new AbortController()
    const { abortableDelay } = await import("@/lib/abortable-delay")
    vi.mocked(abortableDelay).mockImplementationOnce(async () => {
      controller.abort()
    })

    await expect(runVectorFormatMigration(controller.signal)).rejects.toThrow()
    expect(stored.size).toBe(0)

    await runVectorFormatMigration()

    const rows = await vectorDb.vectors.toArray()
    expect(
      rows.every((row) => row.normalizedEmbedding instanceof Float32Array)
    ).toBe(true)
  })
})
