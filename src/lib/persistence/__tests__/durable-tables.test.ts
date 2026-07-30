import { readdirSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import {
  countDurableTables,
  DURABLE_TABLES,
  describeMismatches,
  findMissingDurableTables,
  findTableCountMismatches,
  isSoundDatabase,
  readIntegrityReport,
  tableExistsSql
} from "../durable-tables"

const readTableNames = (source: string): string[] =>
  [
    ...source.matchAll(
      /CREATE TABLE (?:IF NOT EXISTS )?([A-Za-z_][A-Za-z0-9_]*)/g
    )
  ].map((match) => match[1])

describe("durable table inventory", () => {
  it("names every table the schema and its migrations create", () => {
    const schemaDir = resolve(__dirname, "../../sqlite")
    const migrationsDir = resolve(schemaDir, "migrations")
    const sources = [
      readFileSync(resolve(schemaDir, "schema.ts"), "utf8"),
      ...readdirSync(migrationsDir)
        .filter((entry) => entry.endsWith(".ts"))
        .map((entry) => readFileSync(resolve(migrationsDir, entry), "utf8"))
    ]

    const declared = new Set(sources.flatMap(readTableNames))
    // A table that lands in the schema without landing in DURABLE_TABLES would
    // migrate unverified — the row counts nobody compares are the ones that go
    // missing.
    expect([...declared].sort()).toEqual([...DURABLE_TABLES].sort())
  })
})

describe("table count verification", () => {
  it("counts only the tables the database actually has", () => {
    const present = new Set(["sessions", "messages"])
    const counts = countDurableTables(
      (sql) => (sql.includes("sessions") ? 3 : 40),
      (table) => present.has(table)
    )
    expect(counts).toEqual({ sessions: 3, messages: 40 })
  })

  it("quotes table names in the existence probe", () => {
    expect(tableExistsSql("sessions")).toContain("name = 'sessions'")
  })

  it("ignores destination tables the source never had", () => {
    // Forward migrations create tables during the import; gaining an empty
    // chunk_feedback is correct, not data loss.
    expect(
      findTableCountMismatches(
        { sessions: 2, messages: 9 },
        { sessions: 2, messages: 9, chunk_feedback: 0 }
      )
    ).toEqual([])
  })

  it("reports a source table that arrived short or missing", () => {
    const mismatches = findTableCountMismatches(
      { sessions: 2, messages: 9, prompt_templates: 7 },
      { sessions: 2, messages: 8 }
    )
    expect(mismatches).toEqual([
      { table: "messages", source: 9, imported: 8 },
      { table: "prompt_templates", source: 7, imported: 0 }
    ])
    // Shortfalls, not count pairs: this text reaches the receipt's `failure`,
    // which a support report can carry.
    expect(describeMismatches(mismatches)).toBe(
      "messages short by 1, prompt_templates short by 7"
    )
    expect(describeMismatches(mismatches)).not.toMatch(/\b9\b/)
  })

  it("names a durable table the destination does not have at all", () => {
    // Absent from both sides, so no count can disagree — chunk_feedback reached
    // the schema in 0.10.0 without a migration, and a database predating it
    // passed verification while lacking the table.
    expect(findMissingDurableTables({ sessions: 2, messages: 9 })).toContain(
      "chunk_feedback"
    )
    expect(
      findMissingDurableTables({
        sessions: 0,
        messages: 0,
        files: 0,
        kv_store: 0,
        prompt_templates: 0,
        tool_loop_runs: 0,
        chunk_feedback: 0
      })
    ).toEqual([])
  })
})

describe("integrity reporting", () => {
  it("reads a sound database as ok with no violations", () => {
    const report = readIntegrityReport((sql) =>
      sql.includes("integrity_check") ? [["ok"]] : []
    )
    expect(report).toEqual({ integrityCheck: "ok", foreignKeyViolations: 0 })
    expect(isSoundDatabase(report)).toBe(true)
  })

  it("joins every reported problem and counts foreign-key violations", () => {
    const report = readIntegrityReport((sql) =>
      sql.includes("integrity_check")
        ? [["row 3 missing from index"], ["page 7 is never used"]]
        : [["messages", 4, "sessions", 0]]
    )
    expect(report).toEqual({
      integrityCheck: "row 3 missing from index; page 7 is never used",
      foreignKeyViolations: 1
    })
    expect(isSoundDatabase(report)).toBe(false)
  })

  it("treats an empty integrity_check result as ok", () => {
    expect(readIntegrityReport(() => []).integrityCheck).toBe("ok")
  })
})
