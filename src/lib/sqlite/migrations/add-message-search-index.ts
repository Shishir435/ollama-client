import { logger } from "@/lib/logger"
import type { MigrationDatabase } from "./database"

/**
 * The FTS5 index behind keyword chat search.
 *
 * `messages_fts` is an external-content index over the `messages_searchable`
 * view, so message text is stored once. The view is the single definition of
 * what is searchable: finished user and assistant text, never a streaming
 * partial, a tool result, a system row or a resolved permission notice. Three
 * triggers keep the index in step with every writer — repository calls,
 * backup import, cascade deletes — which is what lets an edit or a delete
 * reindex without any caller knowing the index exists.
 *
 * The index is derived data: it is created, dropped and rebuilt freely and is
 * deliberately not a durable table. A build without FTS5 simply has no index;
 * search then falls back to a bounded `LIKE` scan (see the repository).
 */

export const MESSAGE_SEARCH_TABLE = "messages_fts"
const VIEW = "messages_searchable"

/** What makes a row searchable, written once for the view and the triggers. */
const searchable = (row: "new" | "old" | "messages") => {
  const ref = (column: string) =>
    row === "messages" ? column : `${row}.${column}`
  return `${ref("role")} IN ('user', 'assistant')
      AND COALESCE(${ref("done")}, 1) = 1
      AND length(${ref("content")}) > 0
      AND (${ref("metrics")} IS NULL OR instr(${ref("metrics")}, '"permissionNotice"') = 0)`
}

const TRIGGERS = ["messages_fts_ai", "messages_fts_ad", "messages_fts_au"]

const insertFrom = (row: "new") =>
  `INSERT INTO ${MESSAGE_SEARCH_TABLE}(rowid, content)
      SELECT ${row}.id, ${row}.content WHERE ${searchable(row)};`

const deleteFrom = (row: "old") =>
  `INSERT INTO ${MESSAGE_SEARCH_TABLE}(${MESSAGE_SEARCH_TABLE}, rowid, content)
      SELECT 'delete', ${row}.id, ${row}.content WHERE ${searchable(row)};`

const objectExists = (
  db: MigrationDatabase,
  type: "table" | "trigger" | "view",
  name: string
): boolean => {
  const stmt = db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = ? AND name = ? LIMIT 1"
  )
  stmt.bind([type, name])
  const found = stmt.step()
  stmt.free()
  return found
}

/** Whether the index and every trigger that maintains it are in place. */
export const hasMessageSearchIndex = (db: MigrationDatabase): boolean =>
  objectExists(db, "table", MESSAGE_SEARCH_TABLE) &&
  objectExists(db, "view", VIEW) &&
  TRIGGERS.every((name) => objectExists(db, "trigger", name))

const dropMessageSearchIndex = (db: MigrationDatabase): void => {
  for (const name of TRIGGERS) db.run(`DROP TRIGGER IF EXISTS ${name}`)
  db.run(`DROP TABLE IF EXISTS ${MESSAGE_SEARCH_TABLE}`)
  db.run(`DROP VIEW IF EXISTS ${VIEW}`)
}

/** Re-read every searchable message into the index. */
export const rebuildMessageSearchIndex = (db: MigrationDatabase): void => {
  db.run(
    `INSERT INTO ${MESSAGE_SEARCH_TABLE}(${MESSAGE_SEARCH_TABLE}) VALUES ('rebuild')`
  )
}

export type MessageSearchIndexState = "present" | "created" | "unavailable"

/**
 * Create the index, its triggers and a backfill from existing messages when
 * any part is missing. Idempotent, and safe to call on every open: a complete
 * index costs three catalogue lookups. A SQLite build without FTS5 reports
 * `unavailable` and leaves the database untouched, so message writes can never
 * fail on a trigger that points at a module the build lacks.
 */
export const ensureMessageSearchIndex = (
  db: MigrationDatabase
): MessageSearchIndexState => {
  if (hasMessageSearchIndex(db)) return "present"
  try {
    dropMessageSearchIndex(db)
    db.run(`CREATE VIEW ${VIEW} AS
      SELECT id, content FROM messages WHERE ${searchable("messages")}`)
    db.run(`CREATE VIRTUAL TABLE ${MESSAGE_SEARCH_TABLE} USING fts5(
      content,
      content='${VIEW}',
      content_rowid='id',
      tokenize='unicode61 remove_diacritics 2'
    )`)
    db.run(`CREATE TRIGGER messages_fts_ai AFTER INSERT ON messages BEGIN
      ${insertFrom("new")}
    END`)
    db.run(`CREATE TRIGGER messages_fts_ad AFTER DELETE ON messages BEGIN
      ${deleteFrom("old")}
    END`)
    db.run(`CREATE TRIGGER messages_fts_au
      AFTER UPDATE OF content, role, done, metrics ON messages BEGIN
      ${deleteFrom("old")}
      ${insertFrom("new")}
    END`)
    rebuildMessageSearchIndex(db)
    return "created"
  } catch (error) {
    /** Leave nothing half-built: a trigger without its table breaks inserts. */
    try {
      dropMessageSearchIndex(db)
    } catch {
      // Nothing further to undo.
    }
    logger.warn(
      "Message search index unavailable; keyword search will scan instead",
      "SQLite/migrations",
      { error: error instanceof Error ? error.message : String(error) }
    )
    return "unavailable"
  }
}
