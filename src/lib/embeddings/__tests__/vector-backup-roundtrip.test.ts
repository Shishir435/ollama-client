import { exportDB, importInto } from "dexie-export-import"
import { beforeEach, expect, it } from "vitest"
import { vectorDb } from "../db"
import { encodeVectorDocument } from "../vector-codec"

beforeEach(async () => {
  await vectorDb.vectors.clear()
})

it("round-trips a float32 row through the backup export and import", async () => {
  const id = await vectorDb.vectors.add(
    encodeVectorDocument({
      content: "backed up",
      embedding: [3, 4],
      metadata: { source: "s", type: "file", timestamp: 1 }
    })
  )

  const blob = await exportDB(vectorDb)
  await vectorDb.vectors.clear()
  await importInto(vectorDb, blob, { clearTablesBeforeImport: true })

  const row = await vectorDb.vectors.get(id)
  expect(row?.normalizedEmbedding).toBeInstanceOf(Float32Array)
  expect(row?.embedding[0]).toBeCloseTo(3, 5)
  expect(row?.embedding[1]).toBeCloseTo(4, 5)
})
