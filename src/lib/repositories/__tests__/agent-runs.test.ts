import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  run: vi.fn(),
  flushSave: vi.fn()
}))

vi.mock("@/lib/sqlite/db", () => mocks)

import {
  agentRunCapReason,
  finalAgentRunStatus,
  getActiveAgentRun,
  saveAgentRun
} from "@/lib/repositories/agent-runs"

const state = {
  task: "Check the page",
  targetTabId: 7,
  allowedOrigins: ["https://example.com"],
  steps: [],
  modelTurns: 0,
  actionCount: 0,
  activeMs: 0
}

describe("agent run repository", () => {
  beforeEach(() => vi.clearAllMocks())

  it("force-flushes durable run checkpoints", async () => {
    await saveAgentRun({
      id: "run-1",
      sessionId: "session-1",
      status: "running",
      state,
      createdAt: 1,
      updatedAt: 2
    })

    expect(mocks.run).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO agent_runs"),
      expect.arrayContaining(["run-1", "session-1", "running"])
    )
    expect(mocks.flushSave).toHaveBeenCalled()
  })

  it("returns the single active run", async () => {
    mocks.query.mockResolvedValue([
      {
        id: "run-1",
        sessionId: "session-1",
        status: "awaiting-approval",
        state: JSON.stringify(state),
        createdAt: 1,
        updatedAt: 2,
        completedAt: null
      }
    ])

    await expect(getActiveAgentRun()).resolves.toMatchObject({
      id: "run-1",
      status: "awaiting-approval"
    })
  })

  it("reports every hard cap", () => {
    expect(agentRunCapReason({ ...state, modelTurns: 25 })).toBe(
      "model-turn limit"
    )
    expect(agentRunCapReason({ ...state, actionCount: 15 })).toBe(
      "page-action limit"
    )
    expect(agentRunCapReason({ ...state, activeMs: 15 * 60 * 1000 })).toBe(
      "active-time limit"
    )
  })

  it("preserves capped status over successful loop completion", () => {
    expect(finalAgentRunStatus("page-action limit", false)).toBe("capped")
    expect(finalAgentRunStatus(undefined, true)).toBe("cancelled")
    expect(finalAgentRunStatus(undefined, false)).toBe("completed")
  })
})
