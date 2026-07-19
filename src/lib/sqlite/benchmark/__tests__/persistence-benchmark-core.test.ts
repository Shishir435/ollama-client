import { createRequire } from "node:module"
import type { SqlJsStatic } from "sql.js"
import initSqlJs from "sql.js/dist/sql-wasm.js"
import { beforeAll, describe, expect, it } from "vitest"
import {
  ACTIVE_PATH_SQL,
  createFixture,
  messagesPerTreeChat,
  SCALES,
  type Scale,
  TREE_PLAN
} from "../persistence-benchmark-core"

const require = createRequire(import.meta.url)
const wasmPath = require.resolve("sql.js/dist/sql-wasm.wasm")

let SQL: SqlJsStatic

beforeAll(async () => {
  SQL = await (
    initSqlJs as unknown as (config: {
      locateFile: () => string
    }) => Promise<SqlJsStatic>
  )({ locateFile: () => wasmPath })
})

const count = (database: import("sql.js").Database, sql: string): number =>
  Number(database.exec(sql)[0].values[0][0])

describe("persistence-benchmark-core fixtures", () => {
  it("builds a linear fixture with the configured row counts", () => {
    const scale: Scale = { chats: 4, messages: 16 }
    const database = createFixture(SQL, scale)
    try {
      expect(count(database, "SELECT COUNT(*) FROM sessions")).toBe(4)
      expect(count(database, "SELECT COUNT(*) FROM messages")).toBe(16)
      expect(count(database, "SELECT COUNT(*) FROM files")).toBe(0)
    } finally {
      database.close()
    }
  })

  it("attaches blobs to existing first messages in the binary fixture", () => {
    const scale: Scale = {
      chats: 4,
      messages: 16,
      attachments: {
        count: 2,
        imageBytes: 1024,
        pdfBytes: 2048,
        everyNthChat: 2
      }
    }
    const database = createFixture(SQL, scale)
    try {
      expect(count(database, "SELECT COUNT(*) FROM files")).toBe(2)
      // Every attachment must reference a real message in its own session.
      expect(
        count(
          database,
          `SELECT COUNT(*) FROM files f
           JOIN messages m ON m.id = f.messageId AND m.sessionId = f.sessionId`
        )
      ).toBe(2)
      expect(count(database, "SELECT SUM(LENGTH(data)) FROM files")).toBe(
        1024 + 2048
      )
    } finally {
      database.close()
    }
  })

  it("wires tree parent ids and resolves the active path from currentLeafId", () => {
    const scale: Scale = {
      chats: 2,
      messages: 2 * messagesPerTreeChat(TREE_PLAN),
      tree: TREE_PLAN
    }
    const database = createFixture(SQL, scale)
    try {
      expect(count(database, "SELECT COUNT(*) FROM messages")).toBe(
        scale.messages
      )
      // Every chat has exactly one root and every non-root parent exists in
      // the same session.
      expect(
        count(database, "SELECT COUNT(*) FROM messages WHERE parentId IS NULL")
      ).toBe(2)
      expect(
        count(
          database,
          `SELECT COUNT(*) FROM messages child
           LEFT JOIN messages parent
             ON parent.id = child.parentId
             AND parent.sessionId = child.sessionId
           WHERE child.parentId IS NOT NULL AND parent.id IS NULL`
        )
      ).toBe(0)
      // The wide node has the configured fan-out plus its trunk child.
      expect(
        count(
          database,
          `SELECT MAX(children) FROM (
             SELECT COUNT(*) AS children FROM messages
             WHERE parentId IS NOT NULL GROUP BY parentId
           )`
        )
      ).toBe(TREE_PLAN.wideChildren + 1)
      // Active path from currentLeafId walks the full trunk.
      const path = database.exec(ACTIVE_PATH_SQL)
      expect(path[0].values.length).toBe(TREE_PLAN.trunkDepth)
    } finally {
      database.close()
    }
  })

  it("keeps the published scales internally consistent", () => {
    expect(SCALES.tree.messages).toBe(
      SCALES.tree.chats * messagesPerTreeChat(TREE_PLAN)
    )
    for (const scale of [SCALES.small, SCALES.medium, SCALES.large]) {
      expect(scale.messages % scale.chats).toBe(0)
    }
    const attachments = SCALES.binary.attachments
    expect(attachments).toBeDefined()
    if (attachments) {
      // Attachment placement must stay within the fixture's chat range.
      expect((attachments.count - 1) * attachments.everyNthChat).toBeLessThan(
        SCALES.binary.chats
      )
    }
  })
})
