import type { Database } from "sql.js"

import { logger } from "@/lib/logger"
import { ensureSessionsPinnedColumn } from "./add-session-pinned-column"
import { ensureSessionsSystemPromptColumn } from "./add-session-system-prompt-column"
import { ensureMessagesThinkingColumn } from "./add-thinking-column"
import { ensureToolLoopRunsTable } from "./add-tool-loop-runs-table"

/**
 * A single forward-only schema migration. `up` must be idempotent-safe for the
 * version it targets: it only ever runs against a database whose recorded
 * `user_version` is strictly below `version`, and the runner bumps
 * `user_version` immediately after it succeeds.
 */
export interface Migration {
  version: number
  name: string
  up: (db: Database) => void
}

/**
 * Ordered migration list. Append new entries with the next integer `version`;
 * never renumber or reorder existing ones. When you add a migration, also add
 * the corresponding column/table to `SCHEMA_SQL` so that freshly created
 * databases (which are stamped at `LATEST_SCHEMA_VERSION` and skip the runner)
 * match a fully migrated database.
 *
 * v1 is the baseline: it folds in the historical `thinking` column ALTER so
 * that legacy databases (created before schema versioning, `user_version = 0`)
 * converge to a known v1 state. It is idempotent, so re-running it is harmless.
 */
export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: "add-thinking-column",
    up: ensureMessagesThinkingColumn
  },
  {
    version: 2,
    name: "add-session-pinned-column",
    up: ensureSessionsPinnedColumn
  },
  {
    version: 3,
    name: "add-session-system-prompt-column",
    up: ensureSessionsSystemPromptColumn
  },
  {
    version: 4,
    name: "add-tool-loop-runs-table",
    up: ensureToolLoopRunsTable
  }
]

/** Highest known schema version; fresh databases are stamped with this. */
export const LATEST_SCHEMA_VERSION = MIGRATIONS.reduce(
  (max, migration) => Math.max(max, migration.version),
  0
)

/** Read the database's recorded schema version (`PRAGMA user_version`). */
export const getSchemaVersion = (db: Database): number => {
  const result = db.exec("PRAGMA user_version")
  const value = result[0]?.values?.[0]?.[0]
  return typeof value === "number" ? value : 0
}

/**
 * Stamp the schema version. `PRAGMA user_version` does not accept bound
 * parameters, so the integer is interpolated; callers only ever pass our own
 * migration version numbers, never user input.
 */
export const setSchemaVersion = (db: Database, version: number): void => {
  db.run(`PRAGMA user_version = ${Math.trunc(version)}`)
}

/**
 * Apply every migration whose version is above the database's current
 * `user_version`, in order, bumping the recorded version after each. Returns
 * the number of migrations applied so the caller can decide whether to persist
 * the upgraded database.
 */
export const runMigrations = (db: Database): number => {
  const current = getSchemaVersion(db)
  const pending = MIGRATIONS.filter((m) => m.version > current).sort(
    (a, b) => a.version - b.version
  )

  if (pending.length === 0) return 0

  for (const migration of pending) {
    logger.info(
      `Applying SQLite migration v${migration.version} (${migration.name})`,
      "SQLite/migrations"
    )
    migration.up(db)
    setSchemaVersion(db, migration.version)
  }

  return pending.length
}
