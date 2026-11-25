import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import sqlite3InitModule from "@sqlite.org/sqlite-wasm"
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
import { asMigrationDatabase } from "@/lib/sqlite/migrations/database"
import {
  getSchemaVersion,
  LATEST_SCHEMA_VERSION,
  repairSchemaDrift,
  runMigrations,
  setSchemaVersion
} from "@/lib/sqlite/migrations/migration-runner"
import { SCHEMA_SQL } from "@/lib/sqlite/schema"

/**
 * Chat organisation against the real engine: keyword search and its index,
 * the per-chat connector selection, the manual-title flag, and the forward
 * migration that introduces all three onto a schema-24 database.
 */

const TIMEOUT = 25_000
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

let owner: ReturnType<typeof createChatDbEngine> | undefined

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

afterEach(async () => {
  try {
    await owner?.submit({ op: "flush" })
  } finally {
    owner = undefined
    globalThis.__persistenceHostCall = undefined
  }
}, TIMEOUT)

const boot = async () => {
  vi.resetModules()
  const engine = createChatDbEngine({ wasmBinary: Promise.resolve(wasmBuffer) })
  owner = engine
  const ready = engine.submit({ op: "setBackend", backend: "legacy" })
  globalThis.__persistenceHostCall = async (request) => {
    await ready
    return engine.submit(request)
  }
  return import("../chat-history")
}

type Repo = Awaited<ReturnType<typeof boot>>

const seedSession = async (repo: Repo, id: string, title = "Chat") => {
  await repo.addSession({
    id,
    title,
    createdAt: 1,
    updatedAt: 1,
    messages: []
  })
}

const plain = (hit: { snippet: Array<{ text: string }> }) =>
  hit.snippet.map((part) => part.text).join("")

describe("keyword message search", () => {
  it(
    "finds finished user and assistant text with a highlighted snippet",
    async () => {
      const repo = await boot()
      await seedSession(repo, "s1")
      const id = await repo.addMessage({
        sessionId: "s1",
        role: "assistant",
        content: "The quarterly invoice reconciliation finished without errors",
        timestamp: 10
      })

      const hits = await repo.searchMessages("reconcil")

      expect(hits).toHaveLength(1)
      expect(hits[0]).toMatchObject({
        sessionId: "s1",
        messageId: id,
        role: "assistant"
      })
      expect(hits[0].snippet.filter((part) => part.match)).toEqual([
        { text: "reconciliation", match: true }
      ])
      expect(plain(hits[0])).toContain("quarterly invoice")
    },
    TIMEOUT
  )

  it(
    "finds stored fullwidth text by the same characters",
    async () => {
      const repo = await boot()
      await seedSession(repo, "s1")
      await repo.addMessage({
        sessionId: "s1",
        role: "user",
        content: "ｆｕｌｌｗｉｄｔｈ note",
        timestamp: 10
      })

      expect(await repo.searchMessages("ｆｕｌｌｗｉｄｔｈ")).toHaveLength(1)
      expect(await repo.searchMessages("note")).toHaveLength(1)
    },
    TIMEOUT
  )

  it(
    "ignores tool results, streaming partials and permission notices",
    async () => {
      const repo = await boot()
      await seedSession(repo, "s1")
      await repo.addMessage({
        sessionId: "s1",
        role: "tool",
        content: "zebra payload from a tool",
        timestamp: 1
      })
      await repo.addMessage({
        sessionId: "s1",
        role: "assistant",
        content: "zebra still streaming",
        timestamp: 2,
        done: false
      })
      await repo.addMessage({
        sessionId: "s1",
        role: "assistant",
        content: "zebra permission wording",
        timestamp: 3,
        metrics: {
          permissionNotice: { resolvedAt: 5 }
        } as never
      })

      expect(await repo.searchMessages("zebra")).toEqual([])
    },
    TIMEOUT
  )

  it(
    "drops a message from results once it is deleted",
    async () => {
      const repo = await boot()
      await seedSession(repo, "s1")
      const id = await repo.addMessage({
        sessionId: "s1",
        role: "user",
        content: "remember the marmalade recipe",
        timestamp: 1
      })
      expect(await repo.searchMessages("marmalade")).toHaveLength(1)

      await repo.deleteMessageSubtree(id)

      expect(await repo.searchMessages("marmalade")).toEqual([])
    },
    TIMEOUT
  )

  it(
    "drops every message of a deleted session",
    async () => {
      const repo = await boot()
      await seedSession(repo, "s1")
      await repo.addMessage({
        sessionId: "s1",
        role: "user",
        content: "thistle in the garden",
        timestamp: 1
      })
      await repo.deleteSessionRow("s1")

      expect(await repo.searchMessages("thistle")).toEqual([])
    },
    TIMEOUT
  )

  it(
    "reindexes an edit and a finished stream",
    async () => {
      const repo = await boot()
      await seedSession(repo, "s1")
      const id = await repo.addMessage({
        sessionId: "s1",
        role: "assistant",
        content: "draft about lanterns",
        timestamp: 1,
        done: false
      })
      expect(await repo.searchMessages("lanterns")).toEqual([])

      await repo.updateMessage(id, { done: true })
      expect(await repo.searchMessages("lanterns")).toHaveLength(1)

      await repo.updateMessage(id, { content: "revised text about kettles" })
      expect(await repo.searchMessages("lanterns")).toEqual([])
      expect(await repo.searchMessages("kettles")).toHaveLength(1)
    },
    TIMEOUT
  )

  it(
    "requires every word and treats operators as plain text",
    async () => {
      const repo = await boot()
      await seedSession(repo, "s1")
      await repo.addMessage({
        sessionId: "s1",
        role: "user",
        content: "alpha beta gamma",
        timestamp: 1
      })
      await repo.addMessage({
        sessionId: "s1",
        role: "user",
        content: "alpha only",
        timestamp: 2
      })

      expect(await repo.searchMessages("alpha beta")).toHaveLength(1)
      // `NOT` is a word here, not the FTS operator that would return the
      // second message.
      expect(await repo.searchMessages("alpha NOT beta")).toEqual([])
      expect(await repo.searchMessages('alpha" beta')).toHaveLength(1)
      expect(await repo.searchMessages('"*()-:^')).toEqual([])
      expect(await repo.searchMessages("   ")).toEqual([])
    },
    TIMEOUT
  )

  it(
    "bounds the number of hits",
    async () => {
      const repo = await boot()
      await seedSession(repo, "s1")
      for (let index = 0; index < 8; index += 1) {
        await repo.addMessage({
          sessionId: "s1",
          role: "user",
          content: `needle number ${index}`,
          timestamp: index
        })
      }
      expect(await repo.searchMessages("needle", 3)).toHaveLength(3)
    },
    TIMEOUT
  )

  it(
    "falls back to a bounded scan when the build has no index",
    async () => {
      const repo = await boot()
      await seedSession(repo, "s1")
      await repo.addMessage({
        sessionId: "s1",
        role: "assistant",
        content: "Prefix words then the Rhubarb crumble recipe follows",
        timestamp: 1
      })
      await repo.addMessage({
        sessionId: "s1",
        role: "tool",
        content: "rhubarb from a tool",
        timestamp: 2
      })
      const withIndex = await repo.searchMessages("rhubarb")

      const { query, run } = await import("@/lib/sqlite/db")
      for (const trigger of ["ai", "ad", "au"]) {
        await run(`DROP TRIGGER messages_fts_${trigger}`)
      }
      await run("DROP TABLE messages_fts")
      expect(
        (await query("SELECT 1 FROM sqlite_master WHERE name = 'messages_fts'"))
          .length
      ).toBe(0)

      const scanned = await repo.searchMessages("rhubarb")

      expect(scanned).toHaveLength(1)
      expect(scanned[0].messageId).toBe(withIndex[0].messageId)
      expect(scanned[0].snippet.some((part) => part.match)).toBe(true)
      expect(plain(scanned[0]).toLowerCase()).toContain("rhubarb crumble")
    },
    TIMEOUT
  )
})

describe("session fields", () => {
  it(
    "round-trips the connector selection and the manual-title flag",
    async () => {
      const repo = await boot()
      await seedSession(repo, "s1", "New Chat")
      expect(
        (await repo.getSession("s1"))?.disabledConnectorIds
      ).toBeUndefined()

      await repo.updateSession("s1", {
        disabledConnectorIds: ["c-a", "c-b"],
        title: "Mine",
        titleSource: "manual"
      })
      const stored = await repo.getSession("s1")
      expect(stored).toMatchObject({
        title: "Mine",
        titleSource: "manual",
        disabledConnectorIds: ["c-a", "c-b"]
      })

      await repo.updateSession("s1", { disabledConnectorIds: [] })
      expect((await repo.getSession("s1"))?.disabledConnectorIds).toBe(
        undefined
      )
    },
    TIMEOUT
  )

  it(
    "keeps the selection when a session is created with one",
    async () => {
      const repo = await boot()
      await repo.addSession({
        id: "s2",
        title: "New Chat",
        createdAt: 1,
        updatedAt: 1,
        disabledConnectorIds: ["c-x"],
        messages: []
      })
      expect((await repo.getSession("s2"))?.disabledConnectorIds).toEqual([
        "c-x"
      ])
    },
    TIMEOUT
  )
})

describe("migration from schema 24", () => {
  const oldSchema = () =>
    SCHEMA_SQL.replace(
      ",\n  disabledConnectorIds TEXT,\n  titleSource TEXT",
      ""
    )

  const openOld = async () => {
    const sqlite3 = await (
      sqlite3InitModule as unknown as (config: {
        wasmBinary: ArrayBuffer
      }) => ReturnType<typeof sqlite3InitModule>
    )({ wasmBinary: wasmBuffer })
    const db = new sqlite3.oo1.DB(":memory:")
    db.exec(oldSchema())
    const compat = asMigrationDatabase(db)
    setSchemaVersion(compat, 24)
    return { db, compat }
  }

  it(
    "adds the columns and backfills the search index from existing messages",
    async () => {
      const { db, compat } = await openOld()
      db.exec(
        "INSERT INTO sessions (id, title, createdAt, updatedAt) VALUES ('s', 'Old', 1, 1)"
      )
      db.exec(`INSERT INTO messages (sessionId, role, content, timestamp, done) VALUES
        ('s', 'user', 'legacy question about pelicans', 1, 1),
        ('s', 'assistant', 'pelicans are birds', 2, 1),
        ('s', 'tool', 'pelican tool output', 3, 1),
        ('s', 'assistant', 'pelican partial', 4, 0)`)
      expect(getSchemaVersion(compat)).toBe(24)

      expect(runMigrations(compat)).toBe(LATEST_SCHEMA_VERSION - 24)

      expect(getSchemaVersion(compat)).toBe(LATEST_SCHEMA_VERSION)
      const columns = (
        db.exec({
          sql: "PRAGMA table_info(sessions)",
          returnValue: "resultRows",
          rowMode: "object"
        }) as Array<{ name: string }>
      ).map((row) => row.name)
      expect(columns).toEqual(
        expect.arrayContaining(["disabledConnectorIds", "titleSource"])
      )
      const found = db.exec({
        sql: `SELECT rowid FROM messages_fts WHERE messages_fts MATCH '"pelican"*' ORDER BY rowid`,
        returnValue: "resultRows",
        rowMode: "array"
      }) as number[][]
      expect(found.map((row) => row[0])).toEqual([1, 2])
      repairSchemaDrift(compat)
      expect(repairSchemaDrift(compat)).toBe(0)
      db.close()
    },
    TIMEOUT
  )

  it(
    "rebuilds a missing index on open and keeps it current afterwards",
    async () => {
      const { db, compat } = await openOld()
      runMigrations(compat)
      db.exec("DROP TRIGGER messages_fts_au")
      db.exec(
        "INSERT INTO sessions (id, title, createdAt, updatedAt) VALUES ('s', 'x', 1, 1)"
      )
      db.exec(
        "INSERT INTO messages (sessionId, role, content, timestamp) VALUES ('s', 'user', 'walnut', 1)"
      )

      expect(repairSchemaDrift(compat)).toBeGreaterThan(0)

      db.exec("UPDATE messages SET content = 'chestnut' WHERE id = 1")
      const count = (term: string) =>
        (
          db.exec({
            sql: `SELECT count(*) FROM messages_fts WHERE messages_fts MATCH '"${term}"'`,
            returnValue: "resultRows",
            rowMode: "array"
          }) as number[][]
        )[0][0]
      expect(count("walnut")).toBe(0)
      expect(count("chestnut")).toBe(1)
      db.close()
    },
    TIMEOUT
  )
})
