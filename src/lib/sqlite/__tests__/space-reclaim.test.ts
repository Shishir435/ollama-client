import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { afterEach, beforeAll, describe, expect, it } from "vitest"
import {
  type ChatDbEngine,
  createChatDbEngine
} from "@/lib/persistence/chat-db-engine"
import { deleteLegacyBlob } from "@/lib/persistence/legacy-blob-db"
import type { QueryRow } from "@/lib/persistence/protocol"
import { reclaimDatabaseSpace } from "../space-reclaim"

const require = createRequire(import.meta.url)
let wasmBinary: ArrayBuffer
beforeAll(() => {
  const wasm = readFileSync(
    require.resolve("@sqlite.org/sqlite-wasm/sqlite3.wasm")
  )
  wasmBinary = wasm.buffer.slice(
    wasm.byteOffset,
    wasm.byteOffset + wasm.byteLength
  )
})

const engines: ChatDbEngine[] = []
afterEach(async () => {
  await Promise.all(
    engines
      .splice(0)
      .map((engine) => engine.submit({ op: "flush" }).catch(() => undefined))
  )
  await deleteLegacyBlob()
})

const boot = async () => {
  await deleteLegacyBlob()
  const engine = createChatDbEngine({
    wasmBinary: Promise.resolve(wasmBinary),
    onError: () => undefined
  })
  engines.push(engine)
  await engine.submit({ op: "setBackend", backend: "legacy" })
  return engine
}

const executorFor = (engine: ChatDbEngine) => ({
  query: (sql: string) =>
    engine.submit({ op: "query", sql }) as Promise<QueryRow[]>,
  run: (sql: string) => engine.submit({ op: "run", sql })
})

const pragma = async (engine: ChatDbEngine, name: string) =>
  Number(
    Object.values(
      (
        (await engine.submit({
          op: "query",
          sql: `PRAGMA ${name}`
        })) as QueryRow[]
      )[0]
    )[0]
  )

/** Fills the database with sessions carrying `kb` kilobytes of text each. */
const fill = async (engine: ChatDbEngine, rows: number, kb: number) => {
  await engine.submit({ op: "run", sql: "BEGIN" })
  for (let i = 0; i < rows; i++)
    await engine.submit({
      op: "run",
      sql: "INSERT INTO sessions (id, title, createdAt, updatedAt) VALUES (?, ?, 1, 1)",
      bind: [`s${i}`, "x".repeat(kb * 1024)]
    })
  await engine.submit({ op: "run", sql: "COMMIT" })
}

describe("reclaimDatabaseSpace", () => {
  it("does nothing while little of the file is free", async () => {
    const engine = await boot()
    await fill(engine, 10, 4)

    const result = await reclaimDatabaseSpace(executorFor(engine))

    expect(result.reclaimed).toBe(false)
  })

  it("does nothing when the free space is a small share of a large file", async () => {
    const engine = await boot()
    await fill(engine, 60, 1024)
    await engine.submit({
      op: "run",
      sql: "DELETE FROM sessions WHERE rowid <= 6"
    })

    const result = await reclaimDatabaseSpace(executorFor(engine))

    expect(result.reclaimed).toBe(false)
  })

  it("shrinks the file once enough of it is free", async () => {
    const engine = await boot()
    await fill(engine, 40, 1024)
    const before = await pragma(engine, "page_count")
    await engine.submit({ op: "run", sql: "DELETE FROM sessions" })
    expect(await pragma(engine, "page_count")).toBe(before)

    const result = await reclaimDatabaseSpace(executorFor(engine))

    expect(result.reclaimed).toBe(true)
    expect(result.fileBytesAfter).toBeLessThan(result.fileBytesBefore / 4)
    expect(await pragma(engine, "page_count")).toBeLessThan(before / 4)
    expect(await pragma(engine, "freelist_count")).toBe(0)
  })

  it("keeps the rows that were not deleted and an intact database", async () => {
    const engine = await boot()
    await fill(engine, 40, 1024)
    await engine.submit({
      op: "run",
      sql: "DELETE FROM sessions WHERE id <> 's3'"
    })

    await reclaimDatabaseSpace(executorFor(engine))

    const rows = (await engine.submit({
      op: "query",
      sql: "SELECT id FROM sessions"
    })) as QueryRow[]
    expect(rows.map((row) => row.id)).toEqual(["s3"])
    const check = (await engine.submit({
      op: "query",
      sql: "PRAGMA integrity_check"
    })) as QueryRow[]
    expect(Object.values(check[0])[0]).toBe("ok")
  })

  it("stops before rewriting when aborted", async () => {
    const engine = await boot()
    await fill(engine, 40, 1024)
    await engine.submit({ op: "run", sql: "DELETE FROM sessions" })
    const controller = new AbortController()
    controller.abort()

    await expect(
      reclaimDatabaseSpace(executorFor(engine), controller.signal)
    ).rejects.toThrow()
    expect(await pragma(engine, "freelist_count")).toBeGreaterThan(0)
  })
})
