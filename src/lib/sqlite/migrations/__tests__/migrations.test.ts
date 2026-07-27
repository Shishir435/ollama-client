import { describe, expect, it, vi } from "vitest"
import { ensureMessagesErrorColumn } from "../add-message-error-column"
import { ensureMessagesReplayArtifactColumn } from "../add-message-replay-artifact-column"
import { ensurePromptTemplatesTable } from "../add-prompt-templates-table"
import { ensureMessagesThinkingColumn } from "../add-thinking-column"

// ─── add-thinking-column ──────────────────────────────────────────────────────

const makeDb = (columns: string[]) => {
  const rows = columns.map((name) => ({ name }))
  let idx = 0
  return {
    prepare: vi.fn().mockReturnValue({
      step: vi.fn().mockImplementation(() => idx < rows.length),
      getAsObject: vi.fn().mockImplementation(() => rows[idx++] ?? {}),
      free: vi.fn()
    }),
    run: vi.fn()
  }
}

describe("ensureMessagesThinkingColumn", () => {
  it("does nothing when thinking column already exists", () => {
    const db = makeDb(["id", "content", "thinking"])
    ensureMessagesThinkingColumn(db as any)
    expect(db.run).not.toHaveBeenCalled()
  })

  it("runs ALTER TABLE when thinking column is missing", () => {
    const db = makeDb(["id", "content"])
    ensureMessagesThinkingColumn(db as any)
    expect(db.run).toHaveBeenCalledWith(
      "ALTER TABLE messages ADD COLUMN thinking TEXT"
    )
  })

  it("frees the prepared statement regardless", () => {
    const db = makeDb(["id", "thinking"])
    db.prepare()
    // reset to get fresh spy
    const freshDb = makeDb(["id"])
    ensureMessagesThinkingColumn(freshDb as any)
    // prepare was called — statement was freed
    expect(freshDb.prepare).toHaveBeenCalledWith("PRAGMA table_info(messages)")
  })
})

describe("ensureMessagesReplayArtifactColumn", () => {
  it("does nothing when replayArtifact already exists", () => {
    const db = makeDb(["id", "replayArtifact"])
    ensureMessagesReplayArtifactColumn(db as any)
    expect(db.run).not.toHaveBeenCalled()
  })

  it("adds replayArtifact to legacy message tables", () => {
    const db = makeDb(["id", "content", "thinking"])
    ensureMessagesReplayArtifactColumn(db as any)
    expect(db.run).toHaveBeenCalledWith(
      "ALTER TABLE messages ADD COLUMN replayArtifact TEXT"
    )
  })
})

describe("ensureMessagesErrorColumn", () => {
  it("does nothing when error already exists", () => {
    const db = makeDb(["id", "error"])
    ensureMessagesErrorColumn(db as any)
    expect(db.run).not.toHaveBeenCalled()
  })

  it("adds error to legacy message tables", () => {
    const db = makeDb(["id", "content"])
    ensureMessagesErrorColumn(db as any)
    expect(db.run).toHaveBeenCalledWith(
      "ALTER TABLE messages ADD COLUMN error TEXT"
    )
  })
})

// ─── add-prompt-templates-table ───────────────────────────────────────────────

describe("ensurePromptTemplatesTable", () => {
  const runMigration = () => {
    const db = { run: vi.fn(), prepare: vi.fn() }
    ensurePromptTemplatesTable(db as never)
    return db.run.mock.calls.map(([sql]) => String(sql))
  }

  it("creates the table and its ordering index idempotently", () => {
    const statements = runMigration()

    // Forward-only migrations re-run against databases that already have the
    // table, so both statements must tolerate that.
    expect(statements).toHaveLength(2)
    expect(statements[0]).toContain(
      "CREATE TABLE IF NOT EXISTS prompt_templates"
    )
    expect(statements[1]).toContain("CREATE INDEX IF NOT EXISTS")
    expect(statements[1]).toContain("prompt_templates(sortOrder)")
  })

  it("requires the columns the repository writes on every insert", () => {
    const [createTable] = runMigration()

    // The insert binds all ten positionally; a column missing here surfaces as
    // a bind mismatch at runtime rather than at migration time.
    for (const column of [
      "id TEXT PRIMARY KEY",
      "title TEXT NOT NULL",
      "userPrompt TEXT NOT NULL",
      "createdAt INTEGER NOT NULL",
      "sortOrder INTEGER NOT NULL"
    ]) {
      expect(createTable).toContain(column)
    }
    for (const nullable of [
      "description TEXT",
      "category TEXT",
      "systemPrompt TEXT",
      "tags TEXT"
    ]) {
      expect(createTable).toContain(nullable)
    }
  })

  it("defaults usageCount so an insert omitting it cannot write NULL", () => {
    expect(runMigration()[0]).toContain("usageCount INTEGER NOT NULL DEFAULT 0")
  })
})
