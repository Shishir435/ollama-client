import { beforeEach, describe, expect, it, vi } from "vitest"

const db = vi.hoisted(() => ({
  query: vi.fn(),
  run: vi.fn(),
  flushSave: vi.fn()
}))

vi.mock("@/lib/sqlite/db", () => db)

import {
  deleteToolLoopRun,
  getToolLoopRun,
  pruneStaleToolLoopRuns,
  saveToolLoopRun
} from "../tool-loop-runs"

beforeEach(() => {
  vi.clearAllMocks()
  db.run.mockResolvedValue(undefined)
  db.flushSave.mockResolvedValue(undefined)
})

describe("tool-loop run repository", () => {
  it("serializes and force-flushes checkpoints", async () => {
    await saveToolLoopRun({
      requestId: "request-1",
      sessionId: "session-1",
      model: "qwen",
      providerId: "ollama",
      mode: "native",
      status: "awaiting-confirmation",
      state: {
        iteration: 0,
        phase: "tools",
        workingMessages: [{ role: "user", content: "hi" }],
        toolRuns: []
      },
      updatedAt: 123
    })

    expect(db.run).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO tool_loop_runs"),
      expect.arrayContaining([
        "request-1",
        "session-1",
        "qwen",
        "ollama",
        "native",
        "awaiting-confirmation"
      ])
    )
    expect(db.flushSave).toHaveBeenCalledTimes(1)
  })

  it("parses a saved checkpoint", async () => {
    db.query.mockResolvedValue([
      {
        requestId: "request-1",
        sessionId: null,
        model: "qwen",
        providerId: "ollama",
        mode: "native",
        status: "running",
        state: JSON.stringify({
          iteration: 1,
          phase: "model",
          workingMessages: [],
          toolRuns: []
        }),
        updatedAt: 456
      }
    ])

    await expect(getToolLoopRun("request-1")).resolves.toMatchObject({
      requestId: "request-1",
      sessionId: undefined,
      mode: "native",
      state: { iteration: 1, phase: "model" }
    })
  })

  it("deletes and force-flushes completed checkpoints", async () => {
    await deleteToolLoopRun("request-1")

    expect(db.run).toHaveBeenCalledWith(
      "DELETE FROM tool_loop_runs WHERE requestId = ?",
      ["request-1"]
    )
    expect(db.flushSave).toHaveBeenCalledTimes(1)
  })

  it("prunes and force-flushes abandoned checkpoints", async () => {
    await pruneStaleToolLoopRuns(100)

    expect(db.run).toHaveBeenCalledWith(
      "DELETE FROM tool_loop_runs WHERE updatedAt < ?",
      [100]
    )
    expect(db.flushSave).toHaveBeenCalledTimes(1)
  })
})
