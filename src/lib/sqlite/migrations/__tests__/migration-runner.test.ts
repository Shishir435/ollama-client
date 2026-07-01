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

import {
  getSchemaVersion,
  LATEST_SCHEMA_VERSION,
  MIGRATIONS,
  runMigrations,
  setSchemaVersion
} from "../migration-runner"

// Minimal sql.js Database stub that models `PRAGMA user_version`.
const makeDb = (initialVersion = 0) => {
  let userVersion = initialVersion
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
    })
  }
}

beforeEach(() => {
  ensureMessagesThinkingColumn.mockClear()
  ensureSessionsPinnedColumn.mockClear()
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
    expect(getSchemaVersion(db as never)).toBe(LATEST_SCHEMA_VERSION)
  })

  it("only runs migrations above the current version", () => {
    // A database already at v1 should skip v1 and run only v2.
    const db = makeDb(1)
    const applied = runMigrations(db as never)
    expect(applied).toBe(LATEST_SCHEMA_VERSION - 1)
    expect(ensureMessagesThinkingColumn).not.toHaveBeenCalled()
    expect(ensureSessionsPinnedColumn).toHaveBeenCalledTimes(1)
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
})
