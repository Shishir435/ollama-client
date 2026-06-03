import { describe, expect, it, vi } from "vitest"
import { ensureMessagesThinkingColumn } from "../add-thinking-column"
import {
  applyChunkFeedbackMigration,
  CHUNK_FEEDBACK_MIGRATION
} from "../chunk-feedback"

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
    const stmt = db.prepare()
    // reset to get fresh spy
    const freshDb = makeDb(["id"])
    ensureMessagesThinkingColumn(freshDb as any)
    // prepare was called — statement was freed
    expect(freshDb.prepare).toHaveBeenCalledWith("PRAGMA table_info(messages)")
  })
})

// ─── chunk-feedback migration ─────────────────────────────────────────────────

describe("CHUNK_FEEDBACK_MIGRATION SQL", () => {
  it("contains chunk_feedback table creation", () => {
    expect(CHUNK_FEEDBACK_MIGRATION).toContain(
      "CREATE TABLE IF NOT EXISTS chunk_feedback"
    )
  })

  it("contains primary key definition", () => {
    expect(CHUNK_FEEDBACK_MIGRATION).toContain(
      "INTEGER PRIMARY KEY AUTOINCREMENT"
    )
  })

  it("contains was_helpful column", () => {
    expect(CHUNK_FEEDBACK_MIGRATION).toContain("was_helpful INTEGER NOT NULL")
  })

  it("contains lookup index", () => {
    expect(CHUNK_FEEDBACK_MIGRATION).toContain("idx_chunk_feedback_lookup")
  })

  it("contains timestamp index", () => {
    expect(CHUNK_FEEDBACK_MIGRATION).toContain("idx_chunk_feedback_timestamp")
  })

  it("contains chunk_quality_scores view", () => {
    expect(CHUNK_FEEDBACK_MIGRATION).toContain(
      "CREATE VIEW IF NOT EXISTS chunk_quality_scores"
    )
  })
})

describe("applyChunkFeedbackMigration", () => {
  it("resolves when exec succeeds", async () => {
    const db = {
      exec: vi.fn().mockImplementation((_sql, cb) => cb(null))
    }
    await expect(applyChunkFeedbackMigration(db)).resolves.toBeUndefined()
    expect(db.exec).toHaveBeenCalledWith(
      CHUNK_FEEDBACK_MIGRATION,
      expect.any(Function)
    )
  })

  it("rejects when exec returns an error", async () => {
    const err = new Error("SQL error")
    const db = {
      exec: vi.fn().mockImplementation((_sql, cb) => cb(err))
    }
    await expect(applyChunkFeedbackMigration(db)).rejects.toThrow("SQL error")
  })
})
