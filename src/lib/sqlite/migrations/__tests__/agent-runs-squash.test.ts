import { createRequire } from "node:module"
import initSqlJs from "sql.js/dist/sql-wasm.js"
import { beforeAll, describe, expect, it } from "vitest"

import { rebuildAgentRunsTables } from "../rebuild-agent-runs-tables"

const require = createRequire(import.meta.url)
const wasmPath = require.resolve("sql.js/dist/sql-wasm.wasm")

let SQL: Awaited<ReturnType<typeof initSqlJs>>

beforeAll(async () => {
  SQL = await initSqlJs({ locateFile: () => wasmPath })
})

describe("squashed Agent migration", () => {
  it("creates the shipped shape on a fresh database", () => {
    const db = new SQL.Database()
    rebuildAgentRunsTables(db)

    expect(
      db.exec("PRAGMA table_info(agent_runs)")[0].values.map((row) => row[1])
    ).toEqual(["id", "status", "checkpoint", "createdAt", "updatedAt"])
    expect(
      db.exec("PRAGMA table_info(agent_steps)")[0].values.map((row) => row[1])
    ).toEqual(["id", "runId", "stepId", "status", "receipt", "createdAt"])
    db.close()
  })

  it("repairs a database already stamped 17 without touching chat data", () => {
    const db = new SQL.Database()
    db.run("CREATE TABLE messages (id TEXT PRIMARY KEY, content TEXT NOT NULL)")
    db.run("INSERT INTO messages (id, content) VALUES ('m1', 'keep me')")
    db.run("CREATE TABLE agent_runs (id TEXT PRIMARY KEY, state TEXT)")
    db.run("CREATE TABLE agent_steps (id INTEGER PRIMARY KEY, runId TEXT)")
    db.run("PRAGMA user_version = 17")

    rebuildAgentRunsTables(db)

    expect(db.exec("PRAGMA user_version")[0].values[0][0]).toBe(17)
    expect(
      db.exec("SELECT content FROM messages WHERE id = 'm1'")[0].values
    ).toEqual([["keep me"]])
    expect(
      db.exec("PRAGMA table_info(agent_runs)")[0].values.map((row) => row[1])
    ).toContain("checkpoint")
    db.close()
  })
})
