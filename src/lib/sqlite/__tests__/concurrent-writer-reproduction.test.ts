import { createRequire } from "node:module"
import initSqlJs from "sql.js/dist/sql-wasm.js"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { SQLITE_DB_KEY, SQLITE_DB_NAME, SQLITE_DB_STORE } from "@/lib/constants"
import { SCHEMA_SQL } from "../schema"

const require = createRequire(import.meta.url)
const wasmPath = require.resolve("sql.js/dist/sql-wasm.wasm")

const requestResult = <T>(request: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })

const openBlobStore = async (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open(SQLITE_DB_NAME, 1)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(SQLITE_DB_STORE)) {
        request.result.createObjectStore(SQLITE_DB_STORE)
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })

const readPersistedBlob = async (): Promise<Uint8Array> => {
  const database = await openBlobStore()
  try {
    const transaction = database.transaction(SQLITE_DB_STORE, "readonly")
    const value = await requestResult(
      transaction.objectStore(SQLITE_DB_STORE).get(SQLITE_DB_KEY)
    )
    if (!(value instanceof Uint8Array)) {
      throw new Error("Expected a persisted SQLite blob")
    }
    return value
  } finally {
    database.close()
  }
}

const persistBlob = async (bytes: Uint8Array): Promise<void> => {
  const database = await openBlobStore()
  try {
    const transaction = database.transaction(SQLITE_DB_STORE, "readwrite")
    await requestResult(
      transaction.objectStore(SQLITE_DB_STORE).put(bytes, SQLITE_DB_KEY)
    )
  } finally {
    database.close()
  }
}

const deleteBlobDatabase = async (): Promise<void> =>
  new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(SQLITE_DB_NAME)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
    request.onblocked = () => reject(new Error("SQLite test database blocked"))
  })

describe("sql.js concurrent writer topology", () => {
  beforeEach(deleteBlobDatabase)
  afterEach(deleteBlobDatabase)

  it("proves a stale whole-blob writer can erase another context's committed update", async () => {
    const SQL = await initSqlJs({ locateFile: () => wasmPath })
    const source = new SQL.Database()
    source.run(SCHEMA_SQL)
    await persistBlob(source.export())
    source.close()

    // Two extension contexts independently load the same durable snapshot.
    const sidepanel = new SQL.Database(await readPersistedBlob())
    const background = new SQL.Database(await readPersistedBlob())

    sidepanel.run(
      `INSERT INTO sessions (id, title, createdAt, updatedAt)
       VALUES (?, ?, ?, ?)`,
      ["chat-1", "Concurrent chat", 1, 1]
    )
    sidepanel.run(
      `INSERT INTO messages (sessionId, role, content, timestamp)
       VALUES (?, ?, ?, ?)`,
      ["chat-1", "user", "must survive", 2]
    )
    await persistBlob(sidepanel.export())

    // The stale background instance performs a valid, unrelated write later.
    background.run(
      `INSERT INTO tool_loop_runs
       (requestId, model, mode, status, state, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?)`,
      ["request-1", "model-1", "native", "running", "{}", 3]
    )
    await persistBlob(background.export())

    const durable = new SQL.Database(await readPersistedBlob())
    const messageCount = durable.exec(
      "SELECT COUNT(*) FROM messages WHERE content = 'must survive'"
    )[0].values[0][0]
    const checkpointCount = durable.exec(
      "SELECT COUNT(*) FROM tool_loop_runs WHERE requestId = 'request-1'"
    )[0].values[0][0]

    expect(checkpointCount).toBe(1)
    expect(messageCount).toBe(0)

    durable.close()
    background.close()
    sidepanel.close()
  })
})
