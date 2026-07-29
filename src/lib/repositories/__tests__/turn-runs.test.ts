import { beforeEach, describe, expect, it, vi } from "vitest"

const { query, run, flushSave } = vi.hoisted(() => ({
  query: vi.fn(),
  run: vi.fn(),
  flushSave: vi.fn()
}))

vi.mock("@/lib/sqlite/db", () => ({ query, run, flushSave }))

import { createTurnRun, getTurnRun, updateTurnRun } from "../turn-runs"

beforeEach(() => {
  vi.resetAllMocks()
})

describe("turn-runs repository", () => {
  it("force-flushes submitted intent before returning", async () => {
    await createTurnRun({
      id: "turn-1",
      sessionId: "session-1",
      mode: "retry",
      model: "llama3",
      request: { rawInput: "hello" },
      createdAt: 10
    })

    expect(run).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO turn_runs"),
      [
        "turn-1",
        "session-1",
        "retry",
        "llama3",
        null,
        '{"rawInput":"hello"}',
        10,
        10
      ]
    )
    expect(flushSave).toHaveBeenCalledTimes(1)
  })

  it("parses a valid durable row and rejects invalid lifecycle data", async () => {
    query.mockResolvedValueOnce([
      {
        id: "turn-1",
        sessionId: "session-1",
        mode: "new",
        model: "llama3",
        providerId: null,
        status: "submitted",
        request: '{"rawInput":"hello"}',
        contextReceipt: null,
        userMessageId: null,
        assistantMessageId: null,
        failure: null,
        createdAt: 10,
        updatedAt: 10
      }
    ])

    await expect(getTurnRun("turn-1")).resolves.toEqual(
      expect.objectContaining({
        id: "turn-1",
        mode: "new",
        status: "submitted",
        request: { rawInput: "hello" }
      })
    )

    query.mockResolvedValueOnce([
      {
        id: "turn-2",
        sessionId: "session-1",
        mode: "unknown",
        model: "llama3",
        providerId: null,
        status: "submitted",
        request: "{}",
        contextReceipt: null,
        userMessageId: null,
        assistantMessageId: null,
        failure: null,
        createdAt: 10,
        updatedAt: 10
      }
    ])
    await expect(getTurnRun("turn-2")).resolves.toBeNull()
  })

  it("force-flushes lifecycle and receipt updates", async () => {
    await updateTurnRun("turn-1", {
      status: "generating",
      assistantMessageId: 2
    })

    expect(run).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE turn_runs SET"),
      expect.arrayContaining(["generating", 2, "turn-1"])
    )
    expect(flushSave).toHaveBeenCalledTimes(1)
  })
})
