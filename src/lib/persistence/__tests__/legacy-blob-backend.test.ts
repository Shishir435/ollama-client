import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { type ChatDbEngine, createChatDbEngine } from "../chat-db-engine"
import type { IntegrityReport } from "../durable-tables"
import {
  deleteLegacyBlob,
  readLegacyBlob,
  writeLegacyBlob
} from "../legacy-blob-db"
import type { CountsResult, ImportResult, QueryRow } from "../protocol"

/**
 * The legacy blob backend, driven through the real engine.
 *
 * This is the suite that used to live at `src/lib/sqlite/__tests__/sqlite-module.test.ts`
 * and assert against a mock of sql.js's module surface — that `prepare` was
 * called, that `export` was called. It could have kept passing while the module
 * lost the ability to open a database at all. What it checks now is what the
 * engine *does* to the stored image.
 *
 * Only the legacy backend is exercised here. OPFS needs a browser; that path is
 * covered by `pnpm verify:opfs-migration`. Legacy needs an in-memory database
 * and IndexedDB, both of which vitest has.
 */

const require = createRequire(import.meta.url)
const wasmPath = require.resolve("@sqlite.org/sqlite-wasm/sqlite3.wasm")
let wasmBinary: ArrayBuffer

beforeAll(() => {
  const wasm = readFileSync(wasmPath)
  wasmBinary = wasm.buffer.slice(
    wasm.byteOffset,
    wasm.byteOffset + wasm.byteLength
  )
})

const errors: string[] = []

/** A fresh owner. Creating one models a browser session starting. */
const bootEngine = async (
  integrity?: IntegrityReport
): Promise<ChatDbEngine> => {
  const engine = createChatDbEngine({
    wasmBinary: Promise.resolve(wasmBinary),
    onError: (message) => errors.push(message)
  })
  await engine.submit({ op: "setBackend", backend: "legacy", integrity })
  return engine
}

const addSession = (engine: ChatDbEngine, id: string) =>
  engine.submit({
    op: "run",
    sql: "INSERT INTO sessions (id, title, modelId, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)",
    bind: [id, `Session ${id}`, "llama3.2:3b", 1, 1]
  })

const sessionIds = async (engine: ChatDbEngine): Promise<string[]> => {
  const rows = (await engine.submit({
    op: "query",
    sql: "SELECT id FROM sessions ORDER BY id"
  })) as QueryRow[]
  return rows.map((row) => String(row.id))
}

const bytesOf = (buffer: unknown): Uint8Array =>
  new Uint8Array(buffer as ArrayBuffer)

/**
 * Wait out the save debounce in real time.
 *
 * Deliberately not `vi.useFakeTimers()`. fake-indexeddb drives its own
 * transactions through the timer queue, so faking timers stops IndexedDB
 * answering at all — every read in the test hangs, and so does the next hook.
 * A handful of real seconds across three tests is the cheaper trade.
 */
const afterDebounce = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 1100))

beforeEach(async () => {
  errors.length = 0
  await deleteLegacyBlob()
})

describe("legacy blob backend", () => {
  it("resolves a blob write only after its transaction commits", async () => {
    const putRequest = {} as IDBRequest
    const transaction = {
      error: null,
      objectStore: vi.fn(() => ({ put: vi.fn(() => putRequest) })),
      onabort: null,
      oncomplete: null,
      onerror: null
    } as unknown as IDBTransaction
    const database = {
      close: vi.fn(),
      transaction: vi.fn(() => transaction)
    } as unknown as IDBDatabase
    const openRequest = {
      result: database,
      onerror: null,
      onupgradeneeded: null,
      onsuccess: null
    } as unknown as IDBOpenDBRequest
    const open = vi.spyOn(indexedDB, "open").mockReturnValue(openRequest)

    try {
      let resolved = false
      const write = writeLegacyBlob(new Uint8Array([1, 2, 3])).then(() => {
        resolved = true
      })

      openRequest.onsuccess?.(new Event("success"))
      await Promise.resolve()
      expect(resolved).toBe(false)

      transaction.oncomplete?.(new Event("complete"))
      await write
      expect(resolved).toBe(true)
      expect(database.close).toHaveBeenCalledOnce()
    } finally {
      open.mockRestore()
    }
  })

  it("creates the full schema when IndexedDB holds no database", async () => {
    const engine = await bootEngine()

    const tables = (
      (await engine.submit({
        op: "query",
        sql: "SELECT name FROM sqlite_master WHERE type = 'table'"
      })) as QueryRow[]
    ).map((row) => String(row.name))

    expect(tables).toEqual(
      expect.arrayContaining(["sessions", "messages", "chunk_feedback"])
    )
    // The fresh database is persisted immediately, not left only in memory.
    await expect(readLegacyBlob()).resolves.not.toBeNull()
  })

  it("loads existing rows from the stored image", async () => {
    const first = await bootEngine()
    await addSession(first, "seed")
    await first.submit({ op: "flush" })

    const second = await bootEngine()

    await expect(sessionIds(second)).resolves.toEqual(["seed"])
  })

  it("returns rows as objects and rejects a malformed statement", async () => {
    const engine = await bootEngine()
    await engine.submit({ op: "run", sql: "CREATE TABLE probe (id, name)" })
    await engine.submit({
      op: "run",
      sql: "INSERT INTO probe VALUES (?, ?)",
      bind: [1, "test"]
    })

    await expect(
      engine.submit({ op: "query", sql: "SELECT * FROM probe" })
    ).resolves.toEqual([{ id: 1, name: "test" }])
    await expect(
      engine.submit({ op: "query", sql: "SELECT * FROM missing_table" })
    ).rejects.toThrow(/missing_table/)
  })

  it("rejects a malformed operation without stalling the scheduler", async () => {
    const engine = await bootEngine()

    await expect(
      engine.submit({ op: "query", sql: 42, injected: true })
    ).rejects.toThrow("Invalid persistence operation")
    await expect(engine.submit({ op: "ping" })).resolves.toEqual({ ok: true })
  })

  it("reports lastInsertRowid and changes from inside the same op", async () => {
    const engine = await bootEngine()
    await addSession(engine, "counted")

    const result = (await engine.submit({
      op: "run",
      sql: "INSERT INTO messages (sessionId, role, content, timestamp) VALUES (?, ?, ?, ?)",
      bind: ["counted", "user", "hello", 1]
    })) as { lastInsertRowid: number; changes: number }

    expect(result).toEqual({ lastInsertRowid: 1, changes: 1 })
  })

  // -------------------------------------------------------------------------
  // Durability
  // -------------------------------------------------------------------------

  it("debounces the image write and forces it on flush", async () => {
    const engine = await bootEngine()
    await engine.submit({ op: "flush" })
    const before = await readLegacyBlob()

    await addSession(engine, "debounced")
    // Not written on the statement — that is the whole point of the debounce,
    // so streaming a long reply does not rewrite the file on every token.
    expect(await readLegacyBlob()).toEqual(before)

    await afterDebounce()
    expect(await readLegacyBlob()).not.toEqual(before)
    // And a second boot sees it, which is the only thing the debounce is for.
    await expect(sessionIds(await bootEngine())).resolves.toEqual(["debounced"])
  })

  it("forces the pending write on flush without waiting for the debounce", async () => {
    const engine = await bootEngine()
    await engine.submit({ op: "flush" })
    const before = await readLegacyBlob()

    await addSession(engine, "flushed")
    await engine.submit({ op: "flush" })

    expect(await readLegacyBlob()).not.toEqual(before)
  })

  it("does not persist a partial transaction before COMMIT", async () => {
    const engine = await bootEngine()
    await engine.submit({ op: "flush" })
    const before = await readLegacyBlob()

    await engine.submit({ op: "txBegin", token: "t1" })
    await engine.submit({
      op: "run",
      sql: "INSERT INTO sessions (id, title, modelId, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)",
      bind: ["in-tx", "In tx", "llama3.2:3b", 1, 1],
      tx: "t1"
    })
    await afterDebounce()

    expect(await readLegacyBlob()).toEqual(before)

    await engine.submit({ op: "txCommit", token: "t1" })
    await afterDebounce()

    expect(await readLegacyBlob()).not.toEqual(before)
  })

  it("schedules no write for a rolled-back transaction", async () => {
    const engine = await bootEngine()
    await engine.submit({ op: "flush" })
    const before = await readLegacyBlob()

    await engine.submit({ op: "txBegin", token: "t1" })
    await engine.submit({
      op: "run",
      sql: "INSERT INTO sessions (id, title, modelId, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)",
      bind: ["discarded", "Discarded", "llama3.2:3b", 1, 1],
      tx: "t1"
    })
    await engine.submit({ op: "txRollback", token: "t1" })
    await afterDebounce()

    expect(await readLegacyBlob()).toEqual(before)
  })

  // -------------------------------------------------------------------------
  // Export
  // -------------------------------------------------------------------------

  it("exports an image byte-identical to the stored blob", async () => {
    const engine = await bootEngine()
    await addSession(engine, "round-trip")
    await engine.submit({ op: "flush" })

    const exported = bytesOf(await engine.submit({ op: "exportDb" }))
    const stored = await readLegacyBlob()

    // A round trip that reorganized pages would still pass a row-count check
    // while making the rollback blob a different file from the one that was
    // verified.
    expect(Array.from(exported)).toEqual(Array.from(stored as Uint8Array))
  })

  it("exports an image a later boot can read back", async () => {
    const first = await bootEngine()
    await addSession(first, "exported")
    await first.submit({ op: "flush" })
    const exported = bytesOf(await first.submit({ op: "exportDb" }))

    await deleteLegacyBlob()
    await writeLegacyBlob(exported)

    await expect(sessionIds(await bootEngine())).resolves.toEqual(["exported"])
  })

  // -------------------------------------------------------------------------
  // Backup restore
  // -------------------------------------------------------------------------

  it("replaces the blob with a verified backup", async () => {
    const source = await bootEngine()
    await addSession(source, "from-backup")
    await source.submit({ op: "flush" })
    const backup = bytesOf(await source.submit({ op: "exportDb" }))

    await deleteLegacyBlob()
    const target = await bootEngine()
    await addSession(target, "replaced")
    await target.submit({ op: "flush" })

    const result = (await target.submit({
      op: "importDb",
      bytes: backup.buffer.slice(
        backup.byteOffset,
        backup.byteOffset + backup.byteLength
      ) as ArrayBuffer
    })) as ImportResult

    expect(result.sessions).toBe(1)
    await expect(sessionIds(target)).resolves.toEqual(["from-backup"])
    // The stored blob moved with it, so the next boot agrees.
    await expect(sessionIds(await bootEngine())).resolves.toEqual([
      "from-backup"
    ])
  })

  it("refuses a payload that is not a sound database and keeps the old one", async () => {
    const engine = await bootEngine()
    await addSession(engine, "kept")
    await engine.submit({ op: "flush" })
    const before = await readLegacyBlob()

    await expect(
      engine.submit({
        op: "importDb",
        bytes: new Uint8Array(4096).fill(0x7a).buffer as ArrayBuffer
      })
    ).rejects.toThrow(/integrity_check/)

    await expect(sessionIds(engine)).resolves.toEqual(["kept"])
    expect(await readLegacyBlob()).toEqual(before)
  })

  // -------------------------------------------------------------------------
  // Reset
  // -------------------------------------------------------------------------

  it("drops the blob on reset and starts from an empty database", async () => {
    const engine = await bootEngine()
    await addSession(engine, "wiped")
    await engine.submit({ op: "flush" })

    await engine.submit({ op: "reset" })

    await expect(sessionIds(engine)).resolves.toEqual([])
    const counts = (await engine.submit({ op: "counts" })) as CountsResult
    expect(counts.sessions).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Damaged images
// ---------------------------------------------------------------------------

describe("legacy blob backend, damaged image", () => {
  const unsound: IntegrityReport = {
    integrityCheck: "*** in database main *** Page 4 is never used",
    foreignKeyViolations: 0
  }

  /** A real, populated image, so the damage is the only thing under test. */
  const seedImage = async (): Promise<Uint8Array> => {
    const engine = await bootEngine()
    await addSession(engine, "seed")
    await engine.submit({ op: "flush" })
    return bytesOf(await engine.submit({ op: "exportDb" }))
  }

  it("serves reads and refuses writes when the migration reported damage", async () => {
    await seedImage()
    const engine = await bootEngine(unsound)

    await expect(sessionIds(engine)).resolves.toEqual(["seed"])
    await expect(addSession(engine, "blocked")).rejects.toThrow(/read-only/)
  })

  it("never writes a damaged image back over the blob", async () => {
    await seedImage()
    const before = await readLegacyBlob()
    const engine = await bootEngine(unsound)

    await engine.submit({ op: "flush" })

    expect(await readLegacyBlob()).toEqual(before)
  })

  it("still exports the image for backup", async () => {
    const image = await seedImage()
    const engine = await bootEngine(unsound)

    const exported = bytesOf(await engine.submit({ op: "exportDb" }))

    expect(Array.from(exported)).toEqual(Array.from(image))
  })

  it("clears the refusal after a reset", async () => {
    await seedImage()
    const engine = await bootEngine(unsound)

    await engine.submit({ op: "reset" })

    await expect(addSession(engine, "recovered")).resolves.toBeDefined()
  })

  it("runs its own integrity check when the migration reported nothing", async () => {
    const image = await seedImage()
    // Overwrite a b-tree page with a byte pattern that is structurally invalid
    // while leaving the header intact, so the file still opens and the pragma
    // is what rejects it. This is the operator-override path: no migration ran,
    // so there is no verdict to inherit.
    const damaged = new Uint8Array(image)
    const pageSize = (damaged[16] << 8) | damaged[17]
    damaged.fill(0xff, pageSize, pageSize * 2)
    await writeLegacyBlob(damaged)

    const engine = await bootEngine()

    await expect(addSession(engine, "blocked")).rejects.toThrow(/read-only/)
  })

  it("keeps a payload that is not a database at all exportable", async () => {
    // `deserialize` accepts these bytes — SQLite validates the header lazily,
    // on first read — so the failure surfaces at the integrity check rather
    // than the open. The gate has to hold here too.
    const notADatabase = new Uint8Array(4096).fill(0x7a)
    await writeLegacyBlob(notADatabase)

    const engine = await bootEngine()

    await expect(addSession(engine, "blocked")).rejects.toThrow(/read-only/)
    expect(
      Array.from(bytesOf(await engine.submit({ op: "exportDb" })))
    ).toEqual(Array.from(notADatabase))
  })
})
