import { createRequire } from "node:module"
import initSqlJs from "sql.js/dist/sql-wasm.js"
import { beforeAll, describe, expect, it } from "vitest"

import { ensureAgentRunChatLinkage } from "../add-agent-run-chat-linkage"
import { rebuildAgentRunsTables } from "../rebuild-agent-runs-tables"

const require = createRequire(import.meta.url)
const wasmPath = require.resolve("sql.js/dist/sql-wasm.wasm")

let SQL: Awaited<ReturnType<typeof initSqlJs>>

beforeAll(async () => {
  SQL = await initSqlJs({ locateFile: () => wasmPath })
})

const chatDatabase = () => {
  const db = new SQL.Database()
  db.run(`
    CREATE TABLE messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sessionId TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL
    )
  `)
  return db
}

const columns = (db: ReturnType<typeof chatDatabase>, table: string) =>
  db.exec(`PRAGMA table_info(${table})`)[0].values.map((row) => row[1])

describe("Agent run chat linkage migration", () => {
  it("adds every column and leaves the chat rows alone", () => {
    const db = chatDatabase()
    db.run(
      "INSERT INTO messages (sessionId, role, content) VALUES ('s1', 'user', 'keep me')"
    )
    rebuildAgentRunsTables(db)

    ensureAgentRunChatLinkage(db)

    expect(columns(db, "agent_runs")).toEqual([
      "id",
      "status",
      "checkpoint",
      "createdAt",
      "updatedAt",
      "sessionId",
      "requestMessageId",
      "resultMessageId",
      "parentRunId"
    ])
    expect(columns(db, "messages")).toContain("agentRunId")
    expect(columns(db, "messages")).toContain("agentHandoff")
    expect(db.exec("SELECT content FROM messages")[0].values).toEqual([
      ["keep me"]
    ])
    db.close()
  })

  /**
   * The condition this release cannot survive: a user with no Agent rows at
   * all must upgrade with their chat history intact, and no query they already
   * issue may change its answer.
   */
  it("is a no-op for a database that never ran the Agent", () => {
    const db = chatDatabase()
    db.run(
      "INSERT INTO messages (sessionId, role, content) VALUES ('s1', 'user', 'hi')"
    )

    ensureAgentRunChatLinkage(db)

    expect(db.exec("SELECT COUNT(*) FROM messages")[0].values).toEqual([[1]])
    expect(
      db.exec(
        "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'agent_runs'"
      )[0].values
    ).toEqual([[0]])
    expect(
      db.exec("SELECT agentRunId, agentHandoff FROM messages")[0].values
    ).toEqual([[null, null]])
    db.close()
  })

  it("runs twice without failing", () => {
    const db = chatDatabase()
    rebuildAgentRunsTables(db)

    ensureAgentRunChatLinkage(db)
    expect(() => ensureAgentRunChatLinkage(db)).not.toThrow()
    db.close()
  })
})
