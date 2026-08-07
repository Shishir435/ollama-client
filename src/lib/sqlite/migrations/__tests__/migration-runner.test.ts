import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() }
}))

const ensureMessagesThinkingColumn = vi.fn()
vi.mock("../add-thinking-column", () => ({
  ensureMessagesThinkingColumn: (db: unknown) =>
    ensureMessagesThinkingColumn(db)
}))

const ensureSessionsPinnedColumn = vi.fn()
vi.mock("../add-session-pinned-column", () => ({
  ensureSessionsPinnedColumn: (db: unknown) => ensureSessionsPinnedColumn(db)
}))

const ensureSessionsSystemPromptColumn = vi.fn()
vi.mock("../add-session-system-prompt-column", () => ({
  ensureSessionsSystemPromptColumn: (db: unknown) =>
    ensureSessionsSystemPromptColumn(db)
}))

const ensureToolLoopRunsTable = vi.fn()
vi.mock("../add-tool-loop-runs-table", () => ({
  ensureToolLoopRunsTable: (db: unknown) => ensureToolLoopRunsTable(db)
}))

const ensureSessionsTagsColumn = vi.fn()
vi.mock("../add-session-tags-column", () => ({
  ensureSessionsTagsColumn: (db: unknown) => ensureSessionsTagsColumn(db)
}))

const ensureMessagesReplayArtifactColumn = vi.fn()
vi.mock("../add-message-replay-artifact-column", () => ({
  ensureMessagesReplayArtifactColumn: (db: unknown) =>
    ensureMessagesReplayArtifactColumn(db)
}))

const ensureMessagesUpdatedAtColumn = vi.fn()
vi.mock("../add-message-updated-at-column", () => ({
  ensureMessagesUpdatedAtColumn: (db: unknown) =>
    ensureMessagesUpdatedAtColumn(db)
}))

const ensureMessagesErrorColumn = vi.fn()
vi.mock("../add-message-error-column", () => ({
  ensureMessagesErrorColumn: (db: unknown) => ensureMessagesErrorColumn(db)
}))

const ensurePromptTemplatesTable = vi.fn()
vi.mock("../add-prompt-templates-table", () => ({
  ensurePromptTemplatesTable: (db: unknown) => ensurePromptTemplatesTable(db)
}))

const ensureTurnRunsTable = vi.fn()
vi.mock("../add-turn-runs-table", () => ({
  ensureTurnRunsTable: (db: unknown) => ensureTurnRunsTable(db)
}))

const ensureIngestionRunsTable = vi.fn()
vi.mock("../add-ingestion-runs-table", () => ({
  ensureIngestionRunsTable: (db: unknown) => ensureIngestionRunsTable(db)
}))

const ensureModelPullRunsTable = vi.fn()
vi.mock("../add-model-pull-runs-table", () => ({
  ensureModelPullRunsTable: (db: unknown) => ensureModelPullRunsTable(db)
}))

import {
  getSchemaVersion,
  LATEST_SCHEMA_VERSION,
  MIGRATIONS,
  repairSchemaDrift,
  runMigrations,
  setSchemaVersion
} from "../migration-runner"

// Minimal MigrationDatabase stub that models `PRAGMA user_version`.
const makeDb = (
  initialVersion = 0,
  schema: {
    messages?: string[]
    sessions?: string[]
    tables?: string[]
  } = {}
) => {
  let userVersion = initialVersion
  const columns = {
    messages: schema.messages ?? [
      "thinking",
      "replayArtifact",
      "updatedAt",
      "error"
    ],
    sessions: schema.sessions ?? ["pinned", "systemPrompt", "tags"]
  }
  const tables = new Set(
    schema.tables ?? [
      "tool_loop_runs",
      "prompt_templates",
      "turn_runs",
      "ingestion_runs",
      "model_pull_runs"
    ]
  )
  return {
    getVersion: () => userVersion,
    exec: vi.fn((sql: string) => {
      if (sql.includes("user_version")) {
        return [{ columns: ["user_version"], values: [[userVersion]] }]
      }
      return []
    }),
    run: vi.fn((sql: string) => {
      const match = /PRAGMA user_version = (\d+)/.exec(sql)
      if (match) userVersion = Number(match[1])
    }),
    prepare: vi.fn((sql: string) => {
      const tableInfoMatch = /PRAGMA table_info\((messages|sessions)\)/.exec(
        sql
      )
      const rows = tableInfoMatch
        ? columns[tableInfoMatch[1] as "messages" | "sessions"].map((name) => ({
            name
          }))
        : []
      let index = -1
      let boundTable = ""
      return {
        bind: vi.fn((values: string[]) => {
          boundTable = values[0] ?? ""
        }),
        step: vi.fn(() => {
          if (tableInfoMatch) {
            index += 1
            return index < rows.length
          }
          return tables.has(boundTable)
        }),
        getAsObject: vi.fn(() => rows[index] ?? {}),
        free: vi.fn()
      }
    })
  }
}

beforeEach(() => {
  ensureMessagesThinkingColumn.mockClear()
  ensureSessionsPinnedColumn.mockClear()
  ensureSessionsSystemPromptColumn.mockClear()
  ensureToolLoopRunsTable.mockClear()
  ensureSessionsTagsColumn.mockClear()
  ensureMessagesReplayArtifactColumn.mockClear()
  ensureMessagesUpdatedAtColumn.mockClear()
  ensureMessagesErrorColumn.mockClear()
  ensurePromptTemplatesTable.mockClear()
  ensureTurnRunsTable.mockClear()
  ensureIngestionRunsTable.mockClear()
  ensureModelPullRunsTable.mockClear()
})

describe("migration-runner", () => {
  it("LATEST_SCHEMA_VERSION is the max migration version", () => {
    const expected = MIGRATIONS.reduce((m, x) => Math.max(m, x.version), 0)
    expect(LATEST_SCHEMA_VERSION).toBe(expected)
    expect(LATEST_SCHEMA_VERSION).toBeGreaterThanOrEqual(1)
  })

  it("migration versions are unique and strictly increasing", () => {
    const versions = MIGRATIONS.map((m) => m.version)
    expect(new Set(versions).size).toBe(versions.length)
    const sorted = [...versions].sort((a, b) => a - b)
    expect(versions).toEqual(sorted)
  })

  it("getSchemaVersion reads user_version (default 0)", () => {
    const db = makeDb(0)
    expect(getSchemaVersion(db as never)).toBe(0)
  })

  it("setSchemaVersion stamps the integer version", () => {
    const db = makeDb(0)
    setSchemaVersion(db as never, 3)
    expect(db.run).toHaveBeenCalledWith("PRAGMA user_version = 3")
    expect(getSchemaVersion(db as never)).toBe(3)
  })

  it("upgrades a legacy database (v0) through every migration", () => {
    const db = makeDb(0)
    const applied = runMigrations(db as never)
    expect(applied).toBe(MIGRATIONS.length)
    expect(ensureMessagesThinkingColumn).toHaveBeenCalledTimes(1)
    expect(ensureSessionsPinnedColumn).toHaveBeenCalledTimes(1)
    expect(ensureSessionsSystemPromptColumn).toHaveBeenCalledTimes(1)
    expect(ensureToolLoopRunsTable).toHaveBeenCalledTimes(1)
    expect(ensureSessionsTagsColumn).toHaveBeenCalledTimes(1)
    expect(ensureMessagesReplayArtifactColumn).toHaveBeenCalledTimes(1)
    expect(ensureMessagesErrorColumn).toHaveBeenCalledTimes(1)
    expect(ensurePromptTemplatesTable).toHaveBeenCalledTimes(1)
    expect(ensureTurnRunsTable).toHaveBeenCalledTimes(1)
    expect(ensureIngestionRunsTable).toHaveBeenCalledTimes(1)
    expect(ensureModelPullRunsTable).toHaveBeenCalledTimes(1)
    expect(getSchemaVersion(db as never)).toBe(LATEST_SCHEMA_VERSION)
  })

  it("only runs migrations above the current version", () => {
    // A database already at v1 should skip v1 and run the later migrations.
    const db = makeDb(1)
    const applied = runMigrations(db as never)
    expect(applied).toBe(LATEST_SCHEMA_VERSION - 1)
    expect(ensureMessagesThinkingColumn).not.toHaveBeenCalled()
    expect(ensureSessionsPinnedColumn).toHaveBeenCalledTimes(1)
    expect(ensureSessionsSystemPromptColumn).toHaveBeenCalledTimes(1)
    expect(ensureToolLoopRunsTable).toHaveBeenCalledTimes(1)
    expect(ensureSessionsTagsColumn).toHaveBeenCalledTimes(1)
    expect(ensureMessagesReplayArtifactColumn).toHaveBeenCalledTimes(1)
    expect(ensureMessagesErrorColumn).toHaveBeenCalledTimes(1)
    expect(ensurePromptTemplatesTable).toHaveBeenCalledTimes(1)
    expect(ensureTurnRunsTable).toHaveBeenCalledTimes(1)
    expect(ensureIngestionRunsTable).toHaveBeenCalledTimes(1)
    expect(ensureModelPullRunsTable).toHaveBeenCalledTimes(1)
    expect(getSchemaVersion(db as never)).toBe(LATEST_SCHEMA_VERSION)
  })

  it("is a no-op for a database already at the latest version", () => {
    const db = makeDb(LATEST_SCHEMA_VERSION)
    const applied = runMigrations(db as never)
    expect(applied).toBe(0)
    expect(ensureMessagesThinkingColumn).not.toHaveBeenCalled()
  })

  it("re-running after an upgrade applies nothing", () => {
    const db = makeDb(0)
    runMigrations(db as never)
    ensureMessagesThinkingColumn.mockClear()
    const applied = runMigrations(db as never)
    expect(applied).toBe(0)
    expect(ensureMessagesThinkingColumn).not.toHaveBeenCalled()
  })

  it("repairs physical schema drift even at the latest recorded version", () => {
    const db = makeDb(LATEST_SCHEMA_VERSION, {
      messages: ["thinking", "updatedAt"],
      sessions: ["pinned", "systemPrompt"],
      tables: []
    })

    const repaired = repairSchemaDrift(db as never)

    expect(repaired).toBe(8)
    expect(ensureMessagesReplayArtifactColumn).toHaveBeenCalledWith(db)
    expect(ensureMessagesErrorColumn).toHaveBeenCalledWith(db)
    expect(ensureSessionsTagsColumn).toHaveBeenCalledWith(db)
    expect(ensureToolLoopRunsTable).toHaveBeenCalledWith(db)
    expect(ensurePromptTemplatesTable).toHaveBeenCalledWith(db)
    expect(ensureTurnRunsTable).toHaveBeenCalledWith(db)
    expect(ensureIngestionRunsTable).toHaveBeenCalledWith(db)
    expect(ensureModelPullRunsTable).toHaveBeenCalledWith(db)
    expect(ensureMessagesThinkingColumn).not.toHaveBeenCalled()
    expect(getSchemaVersion(db as never)).toBe(LATEST_SCHEMA_VERSION)
  })

  it("does not rewrite a complete physical schema", () => {
    const db = makeDb(LATEST_SCHEMA_VERSION)

    expect(repairSchemaDrift(db as never)).toBe(0)
    expect(ensureMessagesThinkingColumn).not.toHaveBeenCalled()
    expect(ensureMessagesReplayArtifactColumn).not.toHaveBeenCalled()
    expect(ensureMessagesErrorColumn).not.toHaveBeenCalled()
    expect(ensureSessionsPinnedColumn).not.toHaveBeenCalled()
    expect(ensureSessionsSystemPromptColumn).not.toHaveBeenCalled()
    expect(ensureSessionsTagsColumn).not.toHaveBeenCalled()
    expect(ensureToolLoopRunsTable).not.toHaveBeenCalled()
    expect(ensurePromptTemplatesTable).not.toHaveBeenCalled()
    expect(ensureIngestionRunsTable).not.toHaveBeenCalled()
    expect(ensureModelPullRunsTable).not.toHaveBeenCalled()
  })
})
