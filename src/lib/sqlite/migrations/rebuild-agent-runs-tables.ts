import { ensureAgentRunsTables } from "./add-agent-runs-tables"
import type { MigrationDatabase } from "./database"

const AGENT_RUN_COLUMNS = [
  "id",
  "status",
  "checkpoint",
  "createdAt",
  "updatedAt"
] as const

const AGENT_STEP_COLUMNS = [
  "id",
  "runId",
  "stepId",
  "status",
  "receipt",
  "createdAt"
] as const

const columnsOf = (db: MigrationDatabase, table: string): Set<string> => {
  const stmt = db.prepare(`PRAGMA table_info(${table})`)
  const columns = new Set<string>()
  while (stmt.step()) {
    const row = stmt.getAsObject() as { name?: string }
    if (row.name) columns.add(row.name)
  }
  stmt.free()
  return columns
}

const shapeMatches = (
  db: MigrationDatabase,
  table: string,
  expected: readonly string[]
): boolean => {
  const columns = columnsOf(db, table)
  if (columns.size === 0) return true
  return expected.every((column) => columns.has(column))
}

/** True when an existing Agent table cannot answer the queries we ship. */
export const agentRunsTablesAreStale = (db: MigrationDatabase): boolean =>
  !shapeMatches(db, "agent_runs", AGENT_RUN_COLUMNS) ||
  !shapeMatches(db, "agent_steps", AGENT_STEP_COLUMNS)

/**
 * Migration 17: rebuild the Agent tables when they carry an older shape.
 *
 * A create-if-absent statement is a no-op against a table that already
 * exists, so a profile that ran a pre-release Agent build keeps whatever
 * columns that build wrote, and every query against the shipped shape fails
 * with `no such column`. Nothing here is recoverable across that change: a run row is a
 * checkpoint of a supervision session, and a checkpoint we cannot decode
 * cannot be resumed, so the tables are rebuilt rather than patched column by
 * column. Terminal history is not kept anywhere else, and losing an
 * undecodable interrupted run costs the user nothing they could have acted on.
 */
export const rebuildAgentRunsTables = (db: MigrationDatabase): void => {
  const stale = agentRunsTablesAreStale(db)
  if (stale) {
    db.run("DROP TABLE IF EXISTS agent_steps")
    db.run("DROP TABLE IF EXISTS agent_runs")
  }
  const missing =
    columnsOf(db, "agent_runs").size === 0 ||
    columnsOf(db, "agent_steps").size === 0
  if (stale || missing) ensureAgentRunsTables(db)
}
