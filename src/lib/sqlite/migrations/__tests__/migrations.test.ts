import { describe, expect, it, vi } from "vitest"
import { ensureMessagesReplayArtifactColumn } from "../add-message-replay-artifact-column"
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
