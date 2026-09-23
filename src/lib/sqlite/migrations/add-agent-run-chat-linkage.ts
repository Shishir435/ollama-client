import { logger } from "@/lib/logger"
import type { MigrationDatabase } from "./database"

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

const addColumn = (
  db: MigrationDatabase,
  table: string,
  column: string,
  type: "TEXT" | "INTEGER",
  existing: Set<string>
): void => {
  if (existing.has(column)) return
  logger.info(
    `Adding \`${column}\` column to ${table} table`,
    "SQLite/migrations"
  )
  db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`)
}

/**
 * Migration 18: which conversation a run belongs to, and which run a message
 * came from.
 *
 * Every column is nullable and carries no foreign key, deliberately. A key
 * from `agent_runs` to `messages` would put agent rows inside
 * `deleteMessageSubtree`'s transaction and give that commit — which repairs
 * `sessions.currentLeafId` and must not fail — a new way to fail. The message
 * ids are pointers the repository repairs, the way Dexie vectors are cleaned
 * up after the same delete rather than joining it.
 *
 * On a database with no agent rows this adds six empty columns and two
 * indexes and changes no query's answer, which is what lets it ship ahead of
 * anything that writes them.
 */
export const ensureAgentRunChatLinkage = (db: MigrationDatabase): void => {
  const runColumns = columnsOf(db, "agent_runs")
  if (runColumns.size > 0) {
    addColumn(db, "agent_runs", "sessionId", "TEXT", runColumns)
    addColumn(db, "agent_runs", "requestMessageId", "INTEGER", runColumns)
    addColumn(db, "agent_runs", "resultMessageId", "INTEGER", runColumns)
    addColumn(db, "agent_runs", "parentRunId", "TEXT", runColumns)
  }

  const messageColumns = columnsOf(db, "messages")
  addColumn(db, "messages", "agentRunId", "TEXT", messageColumns)
  addColumn(db, "messages", "agentHandoff", "TEXT", messageColumns)
  ensureAgentRunLinkageIndexes(db)
}

/**
 * The linkage indexes, created only where the columns they index exist.
 *
 * They used to sit in the schema script, which runs on every open before any
 * migration. On a profile older than migration 18 the columns were not there
 * yet, the CREATE INDEX answered `no such column`, and the database never
 * opened — every chat of every upgrading user unreachable behind two indexes.
 *
 * Returns how many it created, so the drift repair counts them: the legacy
 * backend saves its image only when something was repaired, and an index made
 * in memory and never saved would be made again on every open.
 */
export const ensureAgentRunLinkageIndexes = (db: MigrationDatabase): number => {
  let created = 0
  const ensure = (name: string, table: string, column: string, sql: string) => {
    if (!columnsOf(db, table).has(column) || indexExists(db, name)) return
    db.run(sql)
    created += 1
  }
  ensure(
    "idx_agent_runs_session",
    "agent_runs",
    "sessionId",
    "CREATE INDEX IF NOT EXISTS idx_agent_runs_session ON agent_runs(sessionId, createdAt)"
  )
  ensure(
    "idx_messages_agent_run",
    "messages",
    "agentRunId",
    "CREATE INDEX IF NOT EXISTS idx_messages_agent_run ON messages(agentRunId)"
  )
  return created
}

/** Names are this module's own constants, never input, so they interpolate. */
const indexExists = (db: MigrationDatabase, name: string): boolean => {
  const stmt = db.prepare(
    `SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = '${name}'`
  )
  const found = stmt.step()
  stmt.free()
  return found
}
