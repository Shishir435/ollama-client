/// <reference lib="webworker" />
import sqlite3InitModule, {
  type Database,
  type SAHPoolUtil,
  type Sqlite3Static
} from "@sqlite.org/sqlite-wasm"
import sqliteWasmUrl from "@sqlite.org/sqlite-wasm/sqlite3.wasm?url"
import {
  ACTIVE_PATH_SQL,
  summarize
} from "@/lib/sqlite/benchmark/persistence-benchmark-core"
import type {
  SpikeRequest,
  SpikeResponse,
  SpikeRunRequest,
  SpikeWorkerResult
} from "./protocol"

// Section 9.4 spike: official sqlite-wasm with the opfs-sahpool VFS inside
// one dedicated worker. This measures the candidate persistence topology's
// physical import and incremental durable writes — the two properties the
// current full-blob sql.js topology lacks.

const DB_PATH = "/spike-benchmark.sqlite"
const CHECKPOINT_BATCH = 20

const measure = async (work: () => void | Promise<void>): Promise<number> => {
  const startedAt = performance.now()
  await work()
  return performance.now() - startedAt
}

let sqlitePromise: Promise<{
  sqlite3: Sqlite3Static
  pool: SAHPoolUtil
}> | null = null

const initSqlite = (): NonNullable<typeof sqlitePromise> => {
  if (!sqlitePromise) {
    sqlitePromise = (async () => {
      // The published typings declare init() without arguments, but the
      // runtime accepts an Emscripten module config; locateFile is required
      // here so the bundled wasm asset resolves inside the worker chunk.
      const sqlite3 = await (
        sqlite3InitModule as unknown as (config: {
          locateFile: () => string
          print: (message: string) => void
          printErr: (message: string) => void
        }) => Promise<Sqlite3Static>
      )({
        locateFile: () => sqliteWasmUrl,
        print: () => {},
        printErr: (message: string) => console.error("[sqlite3]", message)
      })
      const pool = await sqlite3.installOpfsSAHPoolVfs({
        name: "spike-opfs-sahpool",
        // 1 database + journal/temp headroom, per upstream guidance.
        initialCapacity: 6
      })
      return { sqlite3, pool }
    })()
  }
  return sqlitePromise
}

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

const queryString = (db: Database, sql: string): string => {
  let value = ""
  db.exec({
    sql,
    callback: (row) => {
      value = String((row as unknown[])[0])
    }
  })
  return value
}

const runBenchmark = async (
  request: SpikeRunRequest
): Promise<SpikeWorkerResult> => {
  const { pool } = await initSqlite()
  const bytes = new Uint8Array(request.bytes)

  pool.unlink(DB_PATH)
  let importedBytes = 0
  const importDbMs = await measure(async () => {
    importedBytes = await pool.importDb(DB_PATH, bytes)
  })

  const openDb = (): Database => new pool.OpfsSAHPoolDb(DB_PATH)

  let db = openDb()
  const journalMode = queryString(db, "PRAGMA journal_mode")
  const importedSessions = queryNumber(db, "SELECT COUNT(*) FROM sessions")
  const importedMessages = queryNumber(db, "SELECT COUNT(*) FROM messages")
  const rowCountsOk =
    importedSessions === request.expectedSessions &&
    importedMessages === request.expectedMessages
  if (!rowCountsOk) {
    // Data preservation is the benchmark's prerequisite; timings measured on
    // a partially imported database are meaningless, so fail the run instead
    // of reporting a completed result.
    db.close()
    pool.unlink(DB_PATH)
    throw new Error(
      `Imported row counts mismatch: sessions ${importedSessions}/${request.expectedSessions}, messages ${importedMessages}/${request.expectedMessages}`
    )
  }
  db.close()

  const coldOpenSamples: number[] = []
  const firstSessionPageSamples: number[] = []
  const warmMessagePageSamples: number[] = []
  const activePathSamples: number[] = []
  const durableAppendSamples: number[] = []
  const checkpointChurnSamples: number[] = []

  // One warm-up run is intentionally excluded from reported percentiles,
  // matching the sql.js benchmark protocol.
  for (let iteration = -1; iteration < request.iterations; iteration += 1) {
    let coldDb: Database | undefined
    const coldOpenMs = await measure(() => {
      coldDb = openDb()
    })
    if (!coldDb) throw new Error("Cold database open failed")
    db = coldDb

    const firstSessionPageMs = await measure(() => {
      db.exec(
        "SELECT id, title, updatedAt FROM sessions ORDER BY updatedAt DESC LIMIT 50"
      )
    })
    const warmMessagePageMs = await measure(() => {
      db.exec(
        `SELECT id, role, content, timestamp FROM messages
         WHERE sessionId = 'benchmark-chat-0'
         ORDER BY timestamp DESC LIMIT 50`
      )
    })
    let activePathMs = 0
    if (request.hasTree) {
      activePathMs = await measure(() => {
        db.exec(ACTIVE_PATH_SQL)
      })
    }

    // Incremental durable append: one row inside one transaction. No full
    // database export happens anywhere in this path.
    const durableAppendMs = await measure(() => {
      db.exec({
        sql: `INSERT INTO messages (sessionId, role, content, model, timestamp)
              VALUES (?, ?, ?, ?, ?)`,
        bind: [
          "benchmark-chat-0",
          "user",
          "durable append",
          "benchmark-model",
          Date.now()
        ]
      })
    })
    db.exec({
      sql: "DELETE FROM messages WHERE content = ?",
      bind: ["durable append"]
    })

    // Streaming-checkpoint churn: repeated upserts of one tool-loop row,
    // the doc's "repeated assistant-stream checkpoint update" measure.
    const checkpointState = JSON.stringify({
      step: "stream",
      buffer: "y".repeat(2_048)
    })
    const checkpointChurnMs = await measure(() => {
      for (let update = 0; update < CHECKPOINT_BATCH; update += 1) {
        db.exec({
          sql: `INSERT OR REPLACE INTO tool_loop_runs
                (requestId, sessionId, model, providerId, mode, status, state, updatedAt)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          bind: [
            "spike-checkpoint",
            "benchmark-chat-0",
            "benchmark-model",
            "ollama",
            "native",
            "streaming",
            checkpointState,
            Date.now() + update
          ]
        })
      }
    })
    db.exec({
      sql: "DELETE FROM tool_loop_runs WHERE requestId = ?",
      bind: ["spike-checkpoint"]
    })
    db.close()

    if (iteration >= 0) {
      coldOpenSamples.push(coldOpenMs)
      firstSessionPageSamples.push(firstSessionPageMs)
      warmMessagePageSamples.push(warmMessagePageMs)
      if (request.hasTree) activePathSamples.push(activePathMs)
      durableAppendSamples.push(durableAppendMs)
      checkpointChurnSamples.push(checkpointChurnMs)
    }
  }

  pool.unlink(DB_PATH)

  return {
    importDbMs,
    importedBytes,
    rowCountsOk,
    journalMode,
    coldOpenMs: summarize(coldOpenSamples),
    first50SessionsMs: summarize(firstSessionPageSamples),
    warm50MessagesMs: summarize(warmMessagePageSamples),
    ...(request.hasTree
      ? { activePath50Ms: summarize(activePathSamples) }
      : {}),
    durableAppendMs: summarize(durableAppendSamples),
    checkpointChurn20Ms: summarize(checkpointChurnSamples)
  }
}

const processRequest = async (request: SpikeRequest): Promise<void> => {
  try {
    if (request.type === "run") {
      const result = await runBenchmark(request)
      const response: SpikeResponse = { id: request.id, ok: true, result }
      self.postMessage(response)
      return
    }
    const { pool } = await initSqlite()
    await pool.wipeFiles()
    const response: SpikeResponse = { id: request.id, ok: true }
    self.postMessage(response)
  } catch (error) {
    const response: SpikeResponse = {
      id: request.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    }
    self.postMessage(response)
  }
}

// Async handlers interleave at await points, so requests are serialized
// through one chain: a cleanup arriving mid-run must not wipeFiles() under
// the active database connection.
let operationChain: Promise<void> = Promise.resolve()

self.onmessage = (event: MessageEvent<SpikeRequest>) => {
  operationChain = operationChain.then(() => processRequest(event.data))
}
