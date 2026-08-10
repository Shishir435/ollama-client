import { beforeEach, describe, expect, it, vi } from "vitest"

const { query, run, runWithMeta, flushSave } = vi.hoisted(() => ({
  query: vi.fn(),
  run: vi.fn(),
  runWithMeta: vi.fn(),
  flushSave: vi.fn()
}))

vi.mock("@/lib/sqlite/db", () => ({ query, run, runWithMeta, flushSave }))
vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() }
}))

import {
  createTurnRun,
  finalizeInterruptedCancellations,
  getIncompleteTurnRuns,
  getTurnRun,
  markTurnCancelling,
  updateTurnRun
} from "../turn-runs"

const persistedRequest = {
  version: 1 as const,
  context: {
    rawInput: "hello",
    messages: [],
    hasTabContext: false,
    contextText: "",
    tabDocuments: [],
    memoryEnabled: false,
    maxTabContextChars: 1000,
    maxRagContextChars: 1000,
    groundedOnlyMode: false,
    selectedModel: "llama3",
    selectedModelRef: null
  },
  userMessage: { role: "user" as const, content: "hello" }
}

beforeEach(() => {
  vi.resetAllMocks()
  // Guarded status writes go through runWithMeta; default to "the transition
  // applied" so tests that are not about the state machine read as before.
  runWithMeta.mockResolvedValue({ changes: 1, lastInsertRowid: 0 })
})

describe("turn-runs repository", () => {
  it("force-flushes submitted intent before returning", async () => {
    await createTurnRun({
      id: "turn-1",
      sessionId: "session-1",
      mode: "retry",
      model: "llama3",
      request: persistedRequest,
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
        JSON.stringify(persistedRequest),
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
        request: JSON.stringify(persistedRequest),
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
        request: persistedRequest
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
    await expect(
      updateTurnRun("turn-1", {
        status: "generating",
        assistantMessageId: 2
      })
    ).resolves.toBe(true)

    // A status write is a compare-and-set: the allowed predecessors travel with
    // it so the database refuses an illegal transition.
    expect(runWithMeta).toHaveBeenCalledWith(
      expect.stringContaining("WHERE id = ? AND status IN"),
      expect.arrayContaining([
        "generating",
        2,
        "turn-1",
        "building_context",
        "generating"
      ])
    )
    expect(flushSave).toHaveBeenCalledTimes(1)
  })

  it("refuses a transition the row has already moved past", async () => {
    runWithMeta.mockResolvedValue({ changes: 0, lastInsertRowid: 0 })

    await expect(
      updateTurnRun("turn-1", { status: "generating" })
    ).resolves.toBe(false)
    // Nothing is flushed, because nothing changed — a late generation cannot
    // pull a cancelled or failed row back into flight.
    expect(flushSave).not.toHaveBeenCalled()
  })

  it("persists structured failures and reads legacy failure text", async () => {
    await updateTurnRun("turn-1", {
      status: "failed",
      failure: {
        status: 503,
        message: "Provider unavailable",
        kind: "provider",
        retryable: true
      }
    })
    expect(runWithMeta).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE turn_runs SET"),
      expect.arrayContaining([
        JSON.stringify({
          status: 503,
          message: "Provider unavailable",
          kind: "provider",
          retryable: true
        })
      ])
    )

    query.mockResolvedValueOnce([
      {
        id: "turn-legacy",
        sessionId: "session-1",
        mode: "new",
        model: "llama3",
        providerId: null,
        status: "failed",
        request: JSON.stringify(persistedRequest),
        contextReceipt: null,
        userMessageId: 1,
        assistantMessageId: 2,
        failure: "old failure text",
        createdAt: 10,
        updatedAt: 11
      }
    ])
    await expect(getTurnRun("turn-legacy")).resolves.toEqual(
      expect.objectContaining({
        failure: {
          status: 0,
          message: "old failure text",
          kind: "unknown"
        }
      })
    )
  })
})

describe("turn cancellation intent", () => {
  it("commits intent only for a turn that is still live", async () => {
    runWithMeta.mockResolvedValue({ changes: 1, lastInsertRowid: 0 })

    await expect(markTurnCancelling("turn-1")).resolves.toBe(true)

    const [sql, bind] = runWithMeta.mock.calls[0]
    expect(sql).toContain("status = 'cancelling'")
    expect(sql).toContain("'submitted', 'building_context', 'generating'")
    expect(bind).toContain("turn-1")
    expect(flushSave).toHaveBeenCalledTimes(1)
  })

  it("makes a repeated stop a no-op", async () => {
    // The second stop matches no live row, so it writes nothing — which is what
    // keeps a double-click from producing two lifecycle writes.
    runWithMeta.mockResolvedValue({ changes: 0, lastInsertRowid: 0 })

    await expect(markTurnCancelling("turn-1")).resolves.toBe(false)
    expect(flushSave).not.toHaveBeenCalled()
  })

  it("finishes cancellations whose worker died mid-stop", async () => {
    query.mockResolvedValue([
      { id: "turn-1", assistantMessageId: 7 },
      { id: "turn-2", assistantMessageId: null }
    ])

    // The assistant rows come back with it: settling only the turn leaves a
    // stopped response looking interrupted.
    await expect(finalizeInterruptedCancellations()).resolves.toEqual([
      { id: "turn-1", assistantMessageId: 7 },
      { id: "turn-2", assistantMessageId: undefined }
    ])

    const [sql] = run.mock.calls[0]
    expect(sql).toContain("status = 'cancelled'")
    expect(sql).toContain("WHERE status = 'cancelling'")
    expect(flushSave).toHaveBeenCalledTimes(1)
  })

  it("writes nothing when no cancellation was interrupted", async () => {
    query.mockResolvedValue([])

    await expect(finalizeInterruptedCancellations()).resolves.toEqual([])
    expect(run).not.toHaveBeenCalled()
    expect(flushSave).not.toHaveBeenCalled()
  })
})

describe("turn recovery", () => {
  it("never offers cancellation intent back to recovery", async () => {
    query.mockResolvedValue([])

    await getIncompleteTurnRuns()

    const [sql] = query.mock.calls[0]
    expect(sql).toContain("'submitted', 'building_context', 'generating'")
    expect(sql).not.toContain("cancelling")
  })

  it("quarantines a row it cannot read instead of skipping it forever", async () => {
    query.mockResolvedValue([
      {
        id: "turn-broken",
        sessionId: "session-1",
        mode: "new",
        model: "llama3",
        providerId: null,
        status: "generating",
        request: "{not json",
        contextReceipt: null,
        userMessageId: null,
        assistantMessageId: null,
        failure: null,
        createdAt: 1,
        updatedAt: 1
      }
    ])

    await expect(getIncompleteTurnRuns()).resolves.toEqual([])

    const [sql, bind] = run.mock.calls[0]
    expect(sql).toContain("status = 'failed'")
    expect(bind).toContain("turn-broken")
    // The diagnostic names the record, never its content.
    expect(String(bind[0])).not.toContain("not json")
  })
})
