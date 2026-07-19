import { createRequire } from "node:module"
import { indexedDB } from "fake-indexeddb"
import initSqlJs, { type Database, type SqlJsStatic } from "sql.js"
import { SCHEMA_SQL } from "../src/lib/sqlite/schema"

type ScaleName = "small" | "medium" | "large"

interface Scale {
  chats: number
  messages: number
}

interface SampleSummary {
  p50: number
  p95: number
}

const SCALES: Record<ScaleName, Scale> = {
  small: { chats: 500, messages: 10_000 },
  medium: { chats: 1_000, messages: 20_000 },
  large: { chats: 10_000, messages: 200_000 }
}

const require = createRequire(import.meta.url)
const wasmPath = require.resolve("sql.js/dist/sql-wasm.wasm")
const content = "x".repeat(2_048)

const measure = async (work: () => void | Promise<void>): Promise<number> => {
  const startedAt = performance.now()
  await work()
  return performance.now() - startedAt
}

const summarize = (samples: number[]): SampleSummary => {
  const sorted = [...samples].sort((left, right) => left - right)
  const percentile = (value: number) =>
    sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * value) - 1)]
  return { p50: percentile(0.5), p95: percentile(0.95) }
}

const toMiB = (bytes: number): number => bytes / (1024 * 1024)

const createFixture = (SQL: SqlJsStatic, scale: Scale): Database => {
  const database = new SQL.Database()
  database.run(SCHEMA_SQL)
  database.run("BEGIN")

  const insertSession = database.prepare(
    `INSERT INTO sessions (id, title, modelId, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?)`
  )
  const insertMessage = database.prepare(
    `INSERT INTO messages (sessionId, role, content, model, timestamp)
     VALUES (?, ?, ?, ?, ?)`
  )

  try {
    const messagesPerChat = scale.messages / scale.chats
    for (let chatIndex = 0; chatIndex < scale.chats; chatIndex += 1) {
      const sessionId = `benchmark-chat-${chatIndex}`
      const timestamp = 1_700_000_000_000 + chatIndex
      insertSession.run([
        sessionId,
        `Benchmark chat ${chatIndex}`,
        "benchmark-model",
        timestamp,
        timestamp
      ])
      insertSession.reset()

      for (
        let messageIndex = 0;
        messageIndex < messagesPerChat;
        messageIndex += 1
      ) {
        insertMessage.run([
          sessionId,
          messageIndex % 2 === 0 ? "user" : "assistant",
          content,
          "benchmark-model",
          timestamp + messageIndex
        ])
        insertMessage.reset()
      }
    }
    database.run("COMMIT")
    return database
  } catch (error) {
    database.run("ROLLBACK")
    database.close()
    throw error
  } finally {
    insertMessage.free()
    insertSession.free()
  }
}

const idbRequest = <T>(request: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })

const openStore = async (name: string): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 1)
    request.onupgradeneeded = () => request.result.createObjectStore("sqlite")
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })

const persist = async (name: string, bytes: Uint8Array): Promise<void> => {
  const database = await openStore(name)
  try {
    await idbRequest(
      database.transaction("sqlite", "readwrite").objectStore("sqlite").put(
        bytes,
        "database"
      )
    )
  } finally {
    database.close()
  }
}

const load = async (name: string): Promise<Uint8Array> => {
  const database = await openStore(name)
  try {
    const value = await idbRequest(
      database
        .transaction("sqlite", "readonly")
        .objectStore("sqlite")
        .get("database")
    )
    if (!(value instanceof Uint8Array)) throw new Error("Missing fixture blob")
    return value
  } finally {
    database.close()
  }
}

const runScale = async (
  SQL: SqlJsStatic,
  scaleName: ScaleName,
  iterations: number
) => {
  const scale = SCALES[scaleName]
  const idbName = `persistence-benchmark-${scaleName}`
  const rssBefore = process.memoryUsage().rss
  let fixture: Database | undefined
  const fixtureBuildMs = await measure(() => {
    fixture = createFixture(SQL, scale)
  })
  if (!fixture) throw new Error("Fixture creation failed")

  let fixtureBytes: Uint8Array<ArrayBufferLike> = new Uint8Array()
  const initialExportMs = await measure(() => {
    fixtureBytes = fixture?.export() ?? new Uint8Array()
  })
  const initialPersistMs = await measure(() => persist(idbName, fixtureBytes))

  const coldOpenSamples: number[] = []
  const firstSessionPageSamples: number[] = []
  const warmMessagePageSamples: number[] = []
  const durableAppendSamples: number[] = []

  // One warm-up run is intentionally excluded from reported percentiles.
  for (let iteration = -1; iteration < iterations; iteration += 1) {
    let coldDatabase: Database | undefined
    const coldOpenMs = await measure(async () => {
      coldDatabase = new SQL.Database(await load(idbName))
    })
    if (!coldDatabase) throw new Error("Cold database open failed")

    const firstSessionPageMs = await measure(() => {
      coldDatabase?.exec(
        "SELECT id, title, updatedAt FROM sessions ORDER BY updatedAt DESC LIMIT 50"
      )
    })
    const warmMessagePageMs = await measure(() => {
      coldDatabase?.exec(
        `SELECT id, role, content, timestamp FROM messages
         WHERE sessionId = 'benchmark-chat-0'
         ORDER BY timestamp DESC LIMIT 50`
      )
    })
    coldDatabase.close()

    const appendDatabase = new SQL.Database(fixtureBytes)
    const durableAppendMs = await measure(async () => {
      appendDatabase.run(
        `INSERT INTO messages (sessionId, role, content, model, timestamp)
         VALUES (?, ?, ?, ?, ?)`,
        [
          "benchmark-chat-0",
          "user",
          "durable append",
          "benchmark-model",
          Date.now()
        ]
      )
      await persist(idbName, appendDatabase.export())
    })
    appendDatabase.close()

    if (iteration >= 0) {
      coldOpenSamples.push(coldOpenMs)
      firstSessionPageSamples.push(firstSessionPageMs)
      warmMessagePageSamples.push(warmMessagePageMs)
      durableAppendSamples.push(durableAppendMs)
    }
  }

  fixture.close()
  return {
    scale: scaleName,
    ...scale,
    iterations,
    fixtureMiB: toMiB(fixtureBytes.byteLength),
    fixtureBuildMs,
    initialExportMs,
    initialPersistMs,
    coldOpenMs: summarize(coldOpenSamples),
    first50SessionsMs: summarize(firstSessionPageSamples),
    warm50MessagesMs: summarize(warmMessagePageSamples),
    durableAppendMs: summarize(durableAppendSamples),
    rssDeltaMiB: toMiB(process.memoryUsage().rss - rssBefore)
  }
}

const main = async (): Promise<void> => {
  const scaleArgument =
    process.argv
      .find((argument) => argument.startsWith("--scale="))
      ?.split("=")[1] ?? "small"
  const iterations = Number(
    process.argv
      .find((argument) => argument.startsWith("--iterations="))
      ?.split("=")[1] ?? 5
  )

  if (
    !Number.isInteger(iterations) ||
    iterations < 1 ||
    !["small", "medium", "large", "all"].includes(scaleArgument)
  ) {
    throw new Error(
      "Usage: pnpm benchmark:persistence --scale=small|medium|large|all --iterations=N"
    )
  }

  const SQL = await initSqlJs({ locateFile: () => wasmPath })
  const scaleNames: ScaleName[] =
    scaleArgument === "all"
      ? ["small", "medium", "large"]
      : [scaleArgument as ScaleName]
  const results = []
  for (const scaleName of scaleNames) {
    results.push(await runScale(SQL, scaleName, iterations))
  }

  console.log(
    JSON.stringify(
      {
        measuredAt: new Date().toISOString(),
        runtime: process.version,
        topology: "sql.js full export persisted as one IndexedDB value",
        results
      },
      null,
      2
    )
  )
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
