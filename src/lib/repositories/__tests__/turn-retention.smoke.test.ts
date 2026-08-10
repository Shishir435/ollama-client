import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { isCompactedTurnRequest } from "@ollama-client/contracts/turns"
import sqlite3InitModule, {
  type Database as SqliteWasmDatabase
} from "@sqlite.org/sqlite-wasm"
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from "vitest"
import { SQLITE_DB_KEY, SQLITE_DB_NAME, SQLITE_DB_STORE } from "@/lib/constants"
import { createChatDbEngine } from "@/lib/persistence/chat-db-engine"
import { ensureTurnRunsTable } from "@/lib/sqlite/migrations/add-turn-runs-table"
import { compactTerminalTurnRequests } from "@/lib/sqlite/migrations/compact-terminal-turn-requests"
import { asMigrationDatabase } from "@/lib/sqlite/migrations/database"

/**
 * Retention smoke for `turn_runs` (RELEASE_ROADMAP H4).
 *
 * Runs the real engine and real SQL rather than asserting statement strings,
 * because the claim being defended is about bytes on disk: a settled turn must
 * not keep the conversation, file text and page bodies that produced it. A test
 * that only checked which SQL we emit would pass against a database that still
 * held all of it.
 *
 * `SECRET` is the tell. It is written into the parts of a request that used to
 * be copied forever, and every assertion below asks the database whether any
 * trace of it survives.
 */

const TIMEOUT = 25_000
const SECRET = "highly-identifying-page-body-9f1ee6c8"

const require = createRequire(import.meta.url)
const wasmPath = require.resolve("@sqlite.org/sqlite-wasm/sqlite3.wasm")
let wasmBuffer: ArrayBuffer

beforeAll(() => {
  const wasm = readFileSync(wasmPath)
  wasmBuffer = wasm.buffer.slice(
    wasm.byteOffset,
    wasm.byteOffset + wasm.byteLength
  )
})

const fatRequest = (turn: string) =>
  JSON.stringify({
    version: 1,
    context: {
      rawInput: `question ${turn}`,
      messages: [
        { role: "user", content: `${SECRET} in the prior conversation` },
        { role: "assistant", content: "an earlier answer" }
      ],
      hasTabContext: true,
      contextText: `${SECRET} in the built context`,
      tabDocuments: [
        { id: "tab-1", title: "Private page", content: `${SECRET} in a tab` }
      ],
      files: [
        { text: `${SECRET} in a file`, metadata: { fileName: "notes.txt" } }
      ],
      memoryEnabled: false,
      maxTabContextChars: 10_000,
      maxRagContextChars: 10_000,
      groundedOnlyMode: false,
      selectedModel: "llama3",
      selectedModelRef: null
    },
    userMessage: { role: "user", content: `question ${turn}` }
  })

describe("migration 14 — compact terminal turn requests", () => {
  it(
    "clears settled requests, dates them from the row, and leaves live rows alone",
    async () => {
      // The published typings declare init() without arguments; the runtime
      // accepts an Emscripten config, the same cast the engine makes.
      const sqlite3 = await (
        sqlite3InitModule as unknown as (config: {
          wasmBinary: ArrayBuffer
          print: () => void
          printErr: () => void
        }) => Promise<{
          oo1: { DB: new (name: string) => SqliteWasmDatabase }
        }>
      )({ wasmBinary: wasmBuffer, print: () => {}, printErr: () => {} })

      const raw = new sqlite3.oo1.DB(":memory:")
      const db = asMigrationDatabase(raw)
      ensureTurnRunsTable(db)

      const insert = (id: string, status: string, updatedAt: number) => {
        db.run(
          `INSERT INTO turn_runs
             (id, sessionId, mode, model, status, request, createdAt, updatedAt)
           VALUES (?, 's-1', 'new', 'llama3', ?, ?, 1, ?)`,
          [id, status, fatRequest(id), updatedAt]
        )
      }
      insert("live", "generating", 100)
      insert("done", "completed", 200)
      insert("stopped", "cancelled", 300)
      insert("broke", "failed", 400)

      compactTerminalTurnRequests(db)

      const rows = db.exec("SELECT id, request FROM turn_runs ORDER BY id")[0]
        .values as string[][]
      const byId = new Map(rows.map(([id, request]) => [id, request]))

      // The row a restart can still resume keeps everything it needs.
      expect(byId.get("live")).toContain(SECRET)

      for (const [id, updatedAt] of [
        ["done", 200],
        ["stopped", 300],
        ["broke", 400]
      ] as const) {
        const request = byId.get(id) as string
        expect(request).not.toContain(SECRET)
        expect(isCompactedTurnRequest(JSON.parse(request))).toBe(true)
        // Dated from the row, so the marker describes the turn rather than the
        // upgrade that rewrote it.
        expect(JSON.parse(request).compactedAt).toBe(updatedAt)
      }

      raw.close()
    },
    TIMEOUT
  )
})

/** Stand in for the database owner; see chat-durability.smoke.test.ts. */
const installOwner = () => {
  const engine = createChatDbEngine({ wasmBinary: Promise.resolve(wasmBuffer) })
  const ready = engine.submit({ op: "setBackend", backend: "legacy" })
  globalThis.__persistenceHostCall = async (request) => {
    await ready
    return engine.submit(request)
  }
}

const clearSqliteStore = (): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    const request = indexedDB.open(SQLITE_DB_NAME, 1)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(SQLITE_DB_STORE)) {
        db.createObjectStore(SQLITE_DB_STORE)
      }
    }
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(SQLITE_DB_STORE)) {
        db.close()
        resolve()
        return
      }
      const tx = db.transaction([SQLITE_DB_STORE], "readwrite")
      tx.objectStore(SQLITE_DB_STORE).delete(SQLITE_DB_KEY)
      tx.oncomplete = () => {
        db.close()
        resolve()
      }
      tx.onerror = () => {
        db.close()
        reject(tx.error)
      }
    }
  })

beforeEach(async () => {
  await clearSqliteStore()
}, TIMEOUT)

afterEach(() => {
  globalThis.__persistenceHostCall = undefined
})

const bootFreshContext = async () => {
  vi.resetModules()
  installOwner()
  const facade = await import("@/lib/repositories/chat-history")
  const turns = await import("@/lib/repositories/turn-runs")
  const db = await import("@/lib/sqlite/db")
  await facade.addSession({
    id: "s-turns",
    title: "Retention",
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    messages: []
  })
  return { facade, turns, db }
}

const submitTurn = async (
  turns: typeof import("@/lib/repositories/turn-runs"),
  id: string
) => {
  await turns.createTurnRun({
    id,
    sessionId: "s-turns",
    mode: "new",
    model: "llama3",
    request: JSON.parse(fatRequest(id)),
    createdAt: 1_700_000_000_000
  })
}

const readRequests = async (
  db: typeof import("@/lib/sqlite/db")
): Promise<Array<{ id: string; status: string; request: string }>> =>
  (await db.query(
    "SELECT id, status, request FROM turn_runs ORDER BY id"
  )) as unknown as Array<{ id: string; status: string; request: string }>

describe("durable turn retention", () => {
  it(
    "drops the resumable input in the same write that settles the turn",
    async () => {
      const { turns, db } = await bootFreshContext()
      await submitTurn(turns, "t-1")

      // Live rows keep what a restart needs.
      expect((await readRequests(db))[0].request).toContain(SECRET)

      expect(
        await turns.updateTurnRun("t-1", { status: "building_context" })
      ).toBe(true)
      expect(await turns.updateTurnRun("t-1", { status: "generating" })).toBe(
        true
      )
      expect((await readRequests(db))[0].request).toContain(SECRET)

      expect(await turns.updateTurnRun("t-1", { status: "completed" })).toBe(
        true
      )

      const [row] = await readRequests(db)
      expect(row.status).toBe("completed")
      expect(row.request).not.toContain(SECRET)
      expect(isCompactedTurnRequest(JSON.parse(row.request))).toBe(true)
    },
    TIMEOUT
  )

  it(
    "compacts a cancellation finalized after a restart",
    async () => {
      const { turns, db } = await bootFreshContext()
      await submitTurn(turns, "t-cancel")
      await turns.updateTurnRun("t-cancel", { status: "building_context" })
      expect(await turns.markTurnCancelling("t-cancel")).toBe(true)

      // Still resumable-shaped while the stop settles: the row can be revisited.
      expect((await readRequests(db))[0].request).toContain(SECRET)

      expect(await turns.finalizeCancelledTurn("t-cancel")).toBe(true)
      const [row] = await readRequests(db)
      expect(row.status).toBe("cancelled")
      expect(row.request).not.toContain(SECRET)
    },
    TIMEOUT
  )

  it(
    "compacts a row quarantined for being unreadable",
    async () => {
      const { turns, db } = await bootFreshContext()
      await submitTurn(turns, "t-broken")
      await db.run("UPDATE turn_runs SET request = ? WHERE id = ?", [
        `{"not":"a request","leak":"${SECRET}"}`,
        "t-broken"
      ])

      // Recovery reads it, cannot parse it, and settles it rather than skipping
      // it on every boot forever.
      await expect(turns.getIncompleteTurnRuns()).resolves.toEqual([])

      const [row] = await readRequests(db)
      expect(row.status).toBe("failed")
      expect(row.request).not.toContain(SECRET)
    },
    TIMEOUT
  )

  it(
    "prunes settled receipts past retention and never live ones",
    async () => {
      const { turns, db } = await bootFreshContext()
      await submitTurn(turns, "t-old")
      await submitTurn(turns, "t-recent")
      await submitTurn(turns, "t-live")
      await turns.updateTurnRun("t-old", { status: "building_context" })
      await turns.updateTurnRun("t-old", { status: "failed" })
      await turns.updateTurnRun("t-recent", { status: "building_context" })
      await turns.updateTurnRun("t-recent", { status: "failed" })
      await db.run("UPDATE turn_runs SET updatedAt = 1 WHERE id = ?", ["t-old"])
      // Age alone must not touch a resumable row: a browser closed for six
      // weeks still owes the user this turn.
      await db.run("UPDATE turn_runs SET updatedAt = 1 WHERE id = ?", [
        "t-live"
      ])

      await expect(turns.pruneTerminalTurnRuns(2)).resolves.toBe(1)

      const remaining = (await readRequests(db)).map((row) => row.id)
      expect(remaining).toEqual(["t-live", "t-recent"])
    },
    TIMEOUT
  )

  it(
    "reports live/settled counts and sizes without reading content",
    async () => {
      const { turns, db } = await bootFreshContext()
      await submitTurn(turns, "t-live")
      await submitTurn(turns, "t-done")
      await turns.updateTurnRun("t-done", { status: "building_context" })
      await turns.updateTurnRun("t-done", { status: "completed" })

      const stats = await turns.getTurnStorageStats()
      expect(stats).toMatchObject({
        liveRuns: 1,
        terminalRuns: 1,
        uncompactedTerminalRuns: 0
      })
      // The live row dominates: compaction is the difference being measured.
      expect(stats.largestRequestBytes).toBeGreaterThan(SECRET.length)
      expect(stats.totalRequestBytes).toBeGreaterThan(stats.largestRequestBytes)

      // A settled row that escaped compaction is the one condition nothing else
      // corrects, so the statistic has to notice it.
      await db.run("UPDATE turn_runs SET request = ? WHERE id = ?", [
        fatRequest("t-done"),
        "t-done"
      ])
      await expect(turns.getTurnStorageStats()).resolves.toMatchObject({
        uncompactedTerminalRuns: 1
      })
    },
    TIMEOUT
  )
})
