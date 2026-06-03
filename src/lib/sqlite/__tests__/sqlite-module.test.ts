/**
 * Tests for the sqlite/db.ts module functions.
 *
 * The module opens IndexedDB via its private helpers. fake-indexeddb works
 * fine for single-call scenarios but an open connection that is never
 * explicitly closed causes indexedDB.deleteDatabase to receive `onblocked`
 * in fake-indexeddb, and any subsequent `indexedDB.open` on that same name
 * then hangs indefinitely.
 *
 * To avoid this we replace `globalThis.indexedDB` with a minimal in-memory
 * stub before each test. The stub is rebuilt on every `beforeEach` call so
 * that `vi.clearAllMocks()` (called by the global afterEach in setup.ts)
 * cannot wipe its implementations.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("sql.js/dist/sql-wasm.js", () => ({ default: vi.fn() }))
vi.mock("./migrations/add-thinking-column", () => ({
  ensureMessagesThinkingColumn: vi.fn()
}))
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() }
}))

import initSqlJs from "sql.js/dist/sql-wasm.js"
import {
  exportDatabaseBytes,
  flushSave,
  initSQLite,
  query,
  resetSQLiteDatabase,
  run,
  saveDatabase
} from "../db"

// ---------------------------------------------------------------------------
// Minimal in-memory IndexedDB stub
// ---------------------------------------------------------------------------

/** Bytes last written to the stub IDB store — simulates IndexedDB persistence. */
let storedBytes: Uint8Array | null = null

/**
 * Build a fresh indexedDB stub object (plain JS, not vi.fn) so that
 * vi.clearAllMocks() cannot accidentally clear its implementations.
 */
function buildIndexedDBStub() {
  function makeRequest<T>(
    resolver: (cb: (v: T) => void) => void
  ): IDBRequest<T> {
    const req = {
      result: undefined as unknown as T,
      onsuccess: null as ((e: Event) => void) | null,
      onerror: null as ((e: Event) => void) | null
    }
    resolver((value) => {
      req.result = value
      if (req.onsuccess) {
        req.onsuccess({ target: req } as unknown as Event)
      }
    })
    return req as unknown as IDBRequest<T>
  }

  const fakeObjectStore = {
    get: (key: string) =>
      makeRequest<Uint8Array | null>((done) => {
        Promise.resolve().then(() =>
          done(key === "database" ? storedBytes : null)
        )
      }),
    put: (data: Uint8Array, _key: string) =>
      makeRequest<IDBValidKey>((done) => {
        Promise.resolve().then(() => {
          storedBytes = data
          done("database" as unknown as IDBValidKey)
        })
      })
  }

  const fakeTx = {
    objectStore: (_name: string) => fakeObjectStore
  }

  const fakeDB = {
    transaction: (_names: string[], _mode: string) => fakeTx,
    objectStoreNames: { contains: (_name: string) => true }
  }

  return {
    open(_name: string, _version: number): IDBOpenDBRequest {
      const req = {
        result: fakeDB as unknown as IDBDatabase,
        onsuccess: null as ((e: Event) => void) | null,
        onerror: null as ((e: Event) => void) | null,
        onupgradeneeded: null as ((e: IDBVersionChangeEvent) => void) | null,
        onblocked: null as ((e: Event) => void) | null
      }
      Promise.resolve().then(() => {
        if (req.onsuccess) {
          req.onsuccess({ target: req } as unknown as Event)
        }
      })
      return req as unknown as IDBOpenDBRequest
    },
    deleteDatabase(_name: string): IDBOpenDBRequest {
      const req = {
        onsuccess: null as ((e: Event) => void) | null,
        onerror: null as ((e: Event) => void) | null,
        onblocked: null as ((e: Event) => void) | null
      }
      Promise.resolve().then(() => {
        storedBytes = null
        if (req.onsuccess) {
          req.onsuccess({ target: req } as unknown as Event)
        }
      })
      return req as unknown as IDBOpenDBRequest
    }
  } as unknown as IDBFactory
}

// ---------------------------------------------------------------------------
// SQL.js mock factories
// ---------------------------------------------------------------------------

function buildSQLMocks() {
  const mockStmt = {
    bind: vi.fn(),
    step: vi.fn().mockReturnValue(false),
    getAsObject: vi.fn().mockReturnValue({}),
    free: vi.fn(),
    reset: vi.fn()
  }
  const mockDb = {
    prepare: vi.fn().mockReturnValue(mockStmt),
    run: vi.fn(),
    export: vi.fn().mockReturnValue(new Uint8Array([1, 2, 3])),
    close: vi.fn()
  }
  // Must be a real constructor so `new SQL.Database()` doesn't throw.
  const DatabaseSpy = vi.fn().mockImplementation(function (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this: any
  ) {
    Object.assign(this, mockDb)
  })
  return { mockStmt, mockDb, mockSQL: { Database: DatabaseSpy } }
}

// ---------------------------------------------------------------------------
// chrome + fetch helpers
// ---------------------------------------------------------------------------

function setupChrome() {
  Object.assign(globalThis.chrome, {
    runtime: {
      id: "test-ext",
      getURL: vi
        .fn()
        .mockReturnValue("chrome-extension://test/assets/sql-wasm.wasm")
    }
  })
}

function setupFetch() {
  global.fetch = vi.fn().mockResolvedValue({
    arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8))
  })
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("SQLite DB module", () => {
  beforeEach(async () => {
    // Install fresh IDB stub (rebuilt each time so clearAllMocks can't wipe it)
    vi.stubGlobal("indexedDB", buildIndexedDBStub())
    storedBytes = null

    // Reset module singletons (db, initPromise)
    await resetSQLiteDatabase().catch(() => undefined)

    // vi.clearAllMocks is called by setup.ts afterEach, but we call it here
    // too so tests within this suite start with clean call counts.
    vi.clearAllMocks()

    // Reinstall chrome/fetch mocks (may have been cleared)
    setupChrome()
    setupFetch()

    // Reinstall a fresh IDB stub after clearAllMocks
    vi.stubGlobal("indexedDB", buildIndexedDBStub())
    storedBytes = null
  })

  afterEach(async () => {
    // Null out singletons before restoring globals
    await resetSQLiteDatabase().catch(() => undefined)
    vi.unstubAllGlobals()
  })

  // -------------------------------------------------------------------------
  // 1. initSQLite — new database (no existing data in IndexedDB)
  // -------------------------------------------------------------------------

  it("initSQLite creates a new empty database when no existing data in IndexedDB", async () => {
    const { mockSQL, mockDb } = buildSQLMocks()
    vi.mocked(initSqlJs).mockResolvedValue(mockSQL as any)

    await initSQLite()

    // Database() with no args → new empty DB
    expect(mockSQL.Database).toHaveBeenCalledWith()
    // Schema SQL applied on new DB
    expect(mockDb.run).toHaveBeenCalledWith(
      expect.stringContaining("CREATE TABLE")
    )
  })

  // -------------------------------------------------------------------------
  // 2. initSQLite — loads existing database from IndexedDB
  // -------------------------------------------------------------------------

  it("initSQLite loads existing database from IndexedDB when data is present", async () => {
    // Pre-seed stored bytes so loadDatabaseFromIndexedDB returns them
    storedBytes = new Uint8Array([42, 43, 44, 45])

    const { mockSQL } = buildSQLMocks()
    vi.mocked(initSqlJs).mockResolvedValue(mockSQL as any)

    await initSQLite()

    // Database constructor called with a Uint8Array → loaded from IDB
    expect(mockSQL.Database).toHaveBeenCalledWith(expect.any(Uint8Array))
  })

  // -------------------------------------------------------------------------
  // 3. query — returns array of row objects
  // -------------------------------------------------------------------------

  it("query returns array of row objects", async () => {
    const { mockSQL } = buildSQLMocks()
    vi.mocked(initSqlJs).mockResolvedValue(mockSQL as any)

    // Get the DB instance and wire up a statement mock that returns one row
    const db = await initSQLite()

    // Build a fresh statement mock AFTER initSQLite so no calls have happened
    let stepCount = 0
    const rowStmt = {
      bind: vi.fn(),
      step: vi.fn().mockImplementation(() => {
        stepCount++
        return stepCount === 1 // true only on the first call
      }),
      getAsObject: vi.fn().mockReturnValue({ id: 1, name: "test" }),
      free: vi.fn(),
      reset: vi.fn()
    }
    // Override the prepare mock on the live DB instance to return our row stmt
    ;(db as any).prepare = vi.fn().mockReturnValue(rowStmt)

    const results = await query("SELECT * FROM test")

    expect(results).toEqual([{ id: 1, name: "test" }])
    expect(rowStmt.free).toHaveBeenCalled()
  })

  // -------------------------------------------------------------------------
  // 4. run — executes statement with bind params
  // -------------------------------------------------------------------------

  it("run executes statement and binds parameters", async () => {
    const { mockSQL, mockStmt, mockDb } = buildSQLMocks()
    vi.mocked(initSqlJs).mockResolvedValue(mockSQL as any)

    await initSQLite()

    await run("INSERT INTO test VALUES (?)", [42])

    expect(mockDb.prepare).toHaveBeenCalledWith("INSERT INTO test VALUES (?)")
    expect(mockStmt.bind).toHaveBeenCalledWith([42])
    expect(mockStmt.step).toHaveBeenCalled()
    expect(mockStmt.free).toHaveBeenCalled()
  })

  // -------------------------------------------------------------------------
  // 5. flushSave — calls db.export and saves to IndexedDB
  // -------------------------------------------------------------------------

  it("flushSave calls db.export after initSQLite", async () => {
    const { mockSQL, mockDb } = buildSQLMocks()
    vi.mocked(initSqlJs).mockResolvedValue(mockSQL as any)

    await initSQLite()
    mockDb.export.mockClear()

    await flushSave()

    expect(mockDb.export).toHaveBeenCalled()
  })

  // -------------------------------------------------------------------------
  // 6. saveDatabase — alias of flushSave
  // -------------------------------------------------------------------------

  it("saveDatabase is an alias for flushSave and calls db.export", async () => {
    const { mockSQL, mockDb } = buildSQLMocks()
    vi.mocked(initSqlJs).mockResolvedValue(mockSQL as any)

    await initSQLite()
    mockDb.export.mockClear()

    await saveDatabase()

    expect(mockDb.export).toHaveBeenCalled()
  })

  // -------------------------------------------------------------------------
  // 7. exportDatabaseBytes — returns Uint8Array
  // -------------------------------------------------------------------------

  it("exportDatabaseBytes returns a Uint8Array", async () => {
    const { mockSQL } = buildSQLMocks()
    vi.mocked(initSqlJs).mockResolvedValue(mockSQL as any)

    await initSQLite()

    const bytes = await exportDatabaseBytes()

    expect(bytes).toBeInstanceOf(Uint8Array)
  })

  // -------------------------------------------------------------------------
  // 8. resetSQLiteDatabase — resolves without throwing
  // -------------------------------------------------------------------------

  it("resetSQLiteDatabase resolves without throwing", async () => {
    const { mockSQL } = buildSQLMocks()
    vi.mocked(initSqlJs).mockResolvedValue(mockSQL as any)

    await initSQLite()

    await expect(resetSQLiteDatabase()).resolves.toBeUndefined()
  })
})
