import { createRequire } from "node:module"
import initSqlJs from "sql.js/dist/sql-wasm.js"
import { beforeAll, describe, expect, it } from "vitest"
import { ensureTurnRunMessageIndex } from "../add-persistence-audit-indexes"

const require = createRequire(import.meta.url)
let SQL: Awaited<ReturnType<typeof initSqlJs>>
beforeAll(async () => {
  SQL = await initSqlJs({
    locateFile: () => require.resolve("sql.js/dist/sql-wasm.wasm")
  })
})

const planFor = (db: InstanceType<typeof SQL.Database>) =>
  String(
    db
      .exec(
        "EXPLAIN QUERY PLAN SELECT contextReceipt FROM turn_runs WHERE userMessageId = 7 AND contextReceipt IS NOT NULL ORDER BY createdAt DESC LIMIT 1"
      )[0]
      .values.flat()
  )

describe("turn run message index", () => {
  it("turns the receipt lookup from a table scan into an index search, idempotently", () => {
    const db = new SQL.Database()
    db.run(
      "CREATE TABLE turn_runs (id TEXT PRIMARY KEY, userMessageId INTEGER, contextReceipt TEXT, createdAt INTEGER)"
    )
    expect(planFor(db)).toContain("SCAN")

    ensureTurnRunMessageIndex(db)
    ensureTurnRunMessageIndex(db)

    expect(planFor(db)).toContain("idx_turn_runs_userMessageId")
  })
})
