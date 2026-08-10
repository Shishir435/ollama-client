import { logger } from "@/lib/logger"
import { ensureIngestionRunsTable } from "./add-ingestion-runs-table"
import { ensureMessagesErrorColumn } from "./add-message-error-column"
import { ensureMessagesReplayArtifactColumn } from "./add-message-replay-artifact-column"
import { ensureMessagesUpdatedAtColumn } from "./add-message-updated-at-column"
import { ensureModelPullRunsTable } from "./add-model-pull-runs-table"
import { ensurePromptTemplatesTable } from "./add-prompt-templates-table"
import { ensureSessionsPinnedColumn } from "./add-session-pinned-column"
import { ensureSessionsSystemPromptColumn } from "./add-session-system-prompt-column"
import { ensureSessionsTagsColumn } from "./add-session-tags-column"
import { ensureMessagesThinkingColumn } from "./add-thinking-column"
import { ensureToolLoopRunsTable } from "./add-tool-loop-runs-table"
import { ensureTurnRunsTable } from "./add-turn-runs-table"
import type { MigrationDatabase } from "./database"
import { renameBuildingContextStatus } from "./rename-building-context-status"

/**
 * A single forward-only schema migration. `up` must be idempotent-safe for the
 * version it targets: it only ever runs against a database whose recorded
 * `user_version` is strictly below `version`, and the runner bumps
 * `user_version` immediately after it succeeds.
 */
export interface Migration {
  version: number
  name: string
  up: (db: MigrationDatabase) => void
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
  },
  {
    version: 5,
    name: "add-session-tags-column",
    up: ensureSessionsTagsColumn
  },
  {
    version: 6,
    name: "add-message-replay-artifact-column",
    up: ensureMessagesReplayArtifactColumn
  },
  {
    version: 7,
    name: "add-message-updated-at-column",
    up: ensureMessagesUpdatedAtColumn
  },
  {
    version: 8,
    name: "add-message-error-column",
    up: ensureMessagesErrorColumn
  },
  {
    version: 9,
    name: "add-prompt-templates-table",
    up: ensurePromptTemplatesTable
  },
  {
    version: 10,
    name: "add-turn-runs-table",
    up: ensureTurnRunsTable
  },
  {
    version: 11,
    name: "add-ingestion-runs-table",
    up: ensureIngestionRunsTable
  },
  {
    version: 12,
    name: "add-model-pull-runs-table",
    up: ensureModelPullRunsTable
  },
  {
    version: 13,
    name: "rename-building-context-status",
    up: renameBuildingContextStatus
  }
]

/** Highest known schema version; fresh databases are stamped with this. */
export const LATEST_SCHEMA_VERSION = MIGRATIONS.reduce(
  (max, migration) => Math.max(max, migration.version),
  0
)

/** Read the database's recorded schema version (`PRAGMA user_version`). */
export const getSchemaVersion = (db: MigrationDatabase): number => {
  const result = db.exec("PRAGMA user_version")
  const value = result[0]?.values?.[0]?.[0]
  return typeof value === "number" ? value : 0
}

/**
 * Stamp the schema version. `PRAGMA user_version` does not accept bound
 * parameters, so the integer is interpolated; callers only ever pass our own
 * migration version numbers, never user input.
 */
export const setSchemaVersion = (
  db: MigrationDatabase,
  version: number
): void => {
  db.run(`PRAGMA user_version = ${Math.trunc(version)}`)
}

const getTableColumns = (
  db: MigrationDatabase,
  table: "messages" | "sessions"
) => {
  const stmt = db.prepare(`PRAGMA table_info(${table})`)
  const columns = new Set<string>()
  while (stmt.step()) {
    const row = stmt.getAsObject() as { name?: string }
    if (row.name) columns.add(row.name)
  }
  stmt.free()
  return columns
}

const hasTable = (
  db: MigrationDatabase,
  table:
    | "tool_loop_runs"
    | "prompt_templates"
    | "turn_runs"
    | "ingestion_runs"
    | "model_pull_runs"
) => {
  const stmt = db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1"
  )
  stmt.bind([table])
  const found = stmt.step()
  stmt.free()
  return found
}

/**
 * Repair databases whose recorded version is newer than their physical
 * schema. This can happen on the legacy blob backend, where an older extension
 * context persists a stale full-database snapshot after another context
 * migrated it — the OPFS owner has one writer and cannot. Version-only migration
 * checks cannot detect that state, and subsequent message inserts then fail on
 * missing columns.
 */
export const repairSchemaDrift = (db: MigrationDatabase): number => {
  const messageColumns = getTableColumns(db, "messages")
  const sessionColumns = getTableColumns(db, "sessions")
  const repairs: Array<{ missing: boolean; apply: () => void }> = [
    {
      missing: !messageColumns.has("thinking"),
      apply: () => ensureMessagesThinkingColumn(db)
    },
    {
      missing: !messageColumns.has("replayArtifact"),
      apply: () => ensureMessagesReplayArtifactColumn(db)
    },
    {
      missing: !messageColumns.has("updatedAt"),
      apply: () => ensureMessagesUpdatedAtColumn(db)
    },
    {
      missing: !messageColumns.has("error"),
      apply: () => ensureMessagesErrorColumn(db)
    },
    {
      missing: !sessionColumns.has("pinned"),
      apply: () => ensureSessionsPinnedColumn(db)
    },
    {
      missing: !sessionColumns.has("systemPrompt"),
      apply: () => ensureSessionsSystemPromptColumn(db)
    },
    {
      missing: !sessionColumns.has("tags"),
      apply: () => ensureSessionsTagsColumn(db)
    },
    {
      missing: !hasTable(db, "tool_loop_runs"),
      apply: () => ensureToolLoopRunsTable(db)
    },
    {
      missing: !hasTable(db, "prompt_templates"),
      apply: () => ensurePromptTemplatesTable(db)
    },
    {
      missing: !hasTable(db, "turn_runs"),
      apply: () => ensureTurnRunsTable(db)
    },
    {
      missing: !hasTable(db, "ingestion_runs"),
      apply: () => ensureIngestionRunsTable(db)
    },
    {
      missing: !hasTable(db, "model_pull_runs"),
      apply: () => ensureModelPullRunsTable(db)
    }
  ]

  let repaired = 0
  for (const repair of repairs) {
    if (!repair.missing) continue
    repair.apply()
    repaired += 1
  }

  if (repaired > 0) {
    logger.warn(
      `Repaired ${repaired} SQLite schema item(s) missing at recorded version ${getSchemaVersion(db)}`,
      "SQLite/migrations"
    )
  }
  return repaired
}

/**
 * Apply every migration whose version is above the database's current
 * `user_version`, in order, bumping the recorded version after each. Returns
 * the number of migrations applied so the caller can decide whether to persist
 * the upgraded database.
 */
export const runMigrations = (db: MigrationDatabase): number => {
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
