import { beforeEach, describe, expect, it, vi } from "vitest"

const { query, run, flushSave } = vi.hoisted(() => ({
  query: vi.fn(),
  run: vi.fn(),
  flushSave: vi.fn()
}))

vi.mock("@/lib/sqlite/db", () => ({ query, run, flushSave }))

import { createTurnRun, getTurnRun, updateTurnRun } from "../turn-runs"

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
    expect(run).toHaveBeenCalledWith(
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
