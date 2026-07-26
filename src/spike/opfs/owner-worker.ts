/// <reference lib="webworker" />
import sqlite3InitModule, {
  type Database,
  type SAHPoolUtil,
  type Sqlite3Static
} from "@sqlite.org/sqlite-wasm"
import type {
  AppendPayload,
  CheckpointPayload,
  CountsResult,
  OwnerOp
} from "./owner-protocol"

// Section 9.4 spike phase 2: the single database-owner worker. Hosted by the
// offscreen document only — no other context may open this database. The
// database handle stays open for the worker's lifetime; a terminated worker
// mid-transaction must roll back via the journal on the next open (gate 5).

const DB_PATH = "/spike-owner.sqlite"

const SPIKE_SCHEMA = `
CREATE TABLE IF NOT EXISTS spike_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  writer TEXT NOT NULL,
  seq INTEGER NOT NULL,
  content TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  UNIQUE(writer, seq)
);
CREATE TABLE IF NOT EXISTS spike_checkpoints (
  requestId TEXT PRIMARY KEY,
  state TEXT NOT NULL,
  updatedAt INTEGER NOT NULL
);
`

interface WorkerRequest {
  id: number
  op: OwnerOp
  payload?: unknown
}

// The host fetches the wasm and hands the bytes over before the first op.
// Fetching inside the worker is not portable: Firefox MV2 worker chunks get
// the ?url asset inlined as a giant data: URL, which Emscripten's streaming
// fetch rejects with NetworkError.
interface InitMessage {
  op: "init"
  wasmBinary: ArrayBuffer
}

let resolveWasmBinary: (binary: ArrayBuffer) => void
const wasmBinaryReady = new Promise<ArrayBuffer>((resolve) => {
  resolveWasmBinary = resolve
})

let contextPromise: Promise<{ db: Database; pool: SAHPoolUtil }> | null = null

const openContext = (): NonNullable<typeof contextPromise> => {
  if (!contextPromise) {
    contextPromise = (async () => {
      const wasmBinary = await wasmBinaryReady
      // The published typings declare init() without arguments, but the
      // runtime accepts an Emscripten module config; wasmBinary skips the
      // fetch entirely so the same worker runs on chrome-extension and
      // moz-extension origins.
      const sqlite3 = await (
        sqlite3InitModule as unknown as (config: {
          wasmBinary: ArrayBuffer
          print: (message: string) => void
          printErr: (message: string) => void
        }) => Promise<Sqlite3Static>
      )({
        wasmBinary,
        print: () => {},
        printErr: (message: string) => console.error("[sqlite3]", message)
      })
      const pool: SAHPoolUtil = await sqlite3.installOpfsSAHPoolVfs({
        // Distinct pool/directory from the phase-1 measurement worker so the
        // two spikes never contend for the same SAH handles.
        name: "spike-owner-pool",
        initialCapacity: 6
      })
      const db = new pool.OpfsSAHPoolDb(DB_PATH)
      db.exec(SPIKE_SCHEMA)
      return { db, pool }
    })()
  }
  return contextPromise
}

const openDatabase = async (): Promise<Database> => (await openContext()).db

const queryNumber = (db: Database, sql: string): number => {
  let value = 0
  db.exec({
    sql,
    callback: (row) => {
      value = Number((row as unknown[])[0])
    }
  })
  return value
}

const counts = (db: Database): CountsResult => {
  const byWriter: Record<string, number> = {}
  db.exec({
    sql: "SELECT writer, COUNT(*) FROM spike_messages GROUP BY writer",
    callback: (row) => {
      const [writer, count] = row as unknown[]
      byWriter[String(writer)] = Number(count)
    }
  })
  return {
    total: queryNumber(db, "SELECT COUNT(*) FROM spike_messages"),
    byWriter
  }
}

const handle = async (op: OwnerOp, payload: unknown): Promise<unknown> => {
  const db = await openDatabase()

  switch (op) {
    case "append": {
      const { writer, seq } = payload as AppendPayload
      // OR IGNORE + UNIQUE(writer, seq): clients retry appends whose response
      // was lost to an owner recreation, so the write must be idempotent.
      db.exec({
        sql: `INSERT OR IGNORE INTO spike_messages (writer, seq, content, timestamp)
              VALUES (?, ?, ?, ?)`,
        bind: [writer, seq, `message ${writer}#${seq}`, Date.now()]
      })
      return counts(db)
    }
    case "counts":
      return counts(db)
    case "upsertCheckpoint": {
      const { requestId, state } = payload as CheckpointPayload
      const updatedAt = Date.now()
      db.exec({
        sql: `INSERT OR REPLACE INTO spike_checkpoints (requestId, state, updatedAt)
              VALUES (?, ?, ?)`,
        bind: [requestId, state, updatedAt]
      })
      return { updatedAt }
    }
    case "readCheckpoint": {
      const { requestId } = payload as { requestId: string }
      let checkpoint: { state: string; updatedAt: number } | null = null
      db.exec({
        sql: "SELECT state, updatedAt FROM spike_checkpoints WHERE requestId = ?",
        bind: [requestId],
        callback: (row) => {
          const [state, updatedAt] = row as unknown[]
          checkpoint = { state: String(state), updatedAt: Number(updatedAt) }
        }
      })
      return checkpoint
    }
    case "checkpointSummary": {
      // One-shot aggregate of the whole checkpoint table: row count and a
      // count per state. Gate 4d reads back a large in-flight burst this way in
      // a single RPC instead of one round-trip per key — hundreds of rapid
      // runtime messages otherwise risk a silently dropped response on MV3.
      const byState: Record<string, number> = {}
      let total = 0
      db.exec({
        sql: "SELECT state, COUNT(*) FROM spike_checkpoints GROUP BY state",
        callback: (row) => {
          const [state, count] = row as unknown[]
          byState[String(state)] = Number(count)
          total += Number(count)
        }
      })
      return { total, byState }
    }
    case "beginHang": {
      // Gate 5 setup: leave an uncommitted transaction open. The driver then
      // terminates this worker; the journal must roll the insert back when
      // the next worker generation reopens the database.
      db.exec("BEGIN IMMEDIATE")
      db.exec({
        sql: `INSERT INTO spike_messages (writer, seq, content, timestamp)
              VALUES (?, ?, ?, ?)`,
        bind: ["hanging-txn", 0, "must roll back", Date.now()]
      })
      return { uncommittedTotal: counts(db).total }
    }
    case "exportDb": {
      // Gate 7: serialize a consistent snapshot while other clients keep
      // writing. Worker ops run on one chain, so the export can never
      // observe a half-applied transaction. The exported bytes are verified
      // by importing them into a scratch file and counting rows.
      const { pool } = await openContext()
      const bytes = await pool.exportFile(DB_PATH)
      const scratchPath = "/spike-export-verify.sqlite"
      await pool.importDb(scratchPath, bytes)
      const scratch = new pool.OpfsSAHPoolDb(scratchPath)
      let verifiedTotal: number
      try {
        verifiedTotal = queryNumber(
          scratch,
          "SELECT COUNT(*) FROM spike_messages"
        )
      } finally {
        scratch.close()
        pool.unlink(scratchPath)
      }
      return { exportedBytes: bytes.byteLength, verifiedTotal }
    }
    case "reset": {
      try {
        db.exec("ROLLBACK")
      } catch {
        // no open transaction
      }
      db.exec("DELETE FROM spike_messages")
      db.exec("DELETE FROM spike_checkpoints")
      return counts(db)
    }
    default:
      throw new Error(`Unknown owner op: ${op}`)
  }
}

const processRequest = async (request: WorkerRequest): Promise<void> => {
  const { id, op, payload } = request
  try {
    const result = await handle(op, payload)
    self.postMessage({ id, ok: true, result })
  } catch (error) {
    self.postMessage({
      id,
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    })
  }
}

// The owner serializes all database operations through one chain — async
// handlers would otherwise interleave at await points and break the
// single-writer ordering the topology exists to guarantee.
let operationChain: Promise<void> = Promise.resolve()

self.onmessage = (event: MessageEvent<WorkerRequest | InitMessage>) => {
  // The init message must be handled outside the op chain: the first op is
  // usually already queued and blocked awaiting the wasm bytes.
  if (event.data.op === "init") {
    resolveWasmBinary((event.data as InitMessage).wasmBinary)
    return
  }
  const request = event.data as WorkerRequest
  operationChain = operationChain.then(() => processRequest(request))
}
