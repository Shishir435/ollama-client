import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  abort: vi.fn(),
  setIntent: vi.fn(),
  sendMessage: vi.fn(),
  getAgentRun: vi.fn(),
  getCurrentAgentRun: vi.fn(),
  getLatestAgentRunForSession: vi.fn(),
  saveAgentRun: vi.fn(),
  getToolLoopRun: vi.fn(),
  deleteToolLoopRun: vi.fn()
}))

vi.mock("@/background/lib/abort-controller-registry", () => ({
  abortAndClearController: mocks.abort
}))

vi.mock("@/background/lib/agent-control-registry", () => ({
  setAgentControlIntent: mocks.setIntent
}))

vi.mock("@/lib/browser-api", () => ({
  browser: {
    tabs: {
      sendMessage: mocks.sendMessage
    }
  }
}))

vi.mock("@/lib/repositories/agent-runs", () => ({
  getAgentRun: mocks.getAgentRun,
  getCurrentAgentRun: mocks.getCurrentAgentRun,
  getLatestAgentRunForSession: mocks.getLatestAgentRunForSession,
  saveAgentRun: mocks.saveAgentRun
}))

vi.mock("@/lib/repositories/tool-loop-runs", () => ({
  getToolLoopRun: mocks.getToolLoopRun,
  deleteToolLoopRun: mocks.deleteToolLoopRun
}))

import {
  pauseAgentRun,
  resumeAgentRun,
  stopAgentRun
} from "../handle-agent-control"

const run = () => ({
  id: "run-1",
  sessionId: "session-1",
  status: "running" as const,
  state: {
    task: "Do work",
    targetTabId: 7,
    allowedOrigins: ["https://example.com"],
    steps: [],
    modelTurns: 1,
    actionCount: 0,
    activeMs: 10
  },
  createdAt: 1,
  updatedAt: 2
})

describe("agent controls", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.sendMessage.mockResolvedValue(undefined)
    mocks.saveAgentRun.mockResolvedValue(undefined)
    mocks.deleteToolLoopRun.mockResolvedValue(undefined)
  })

  it("pauses and aborts without completing the run", async () => {
    const value = run()
    mocks.getAgentRun.mockResolvedValue(value)

    const result = await pauseAgentRun(value.id)

    expect(result.run.status).toBe("paused")
    expect(result.run.completedAt).toBeUndefined()
    expect(mocks.setIntent).toHaveBeenCalledWith(value.id, "pause")
    expect(mocks.abort).toHaveBeenCalledWith(value.id)
    expect(mocks.saveAgentRun).toHaveBeenCalled()
  })

  it("resumes only from a durable checkpoint", async () => {
    const value = { ...run(), status: "paused" as const }
    mocks.getAgentRun.mockResolvedValue(value)
    mocks.getCurrentAgentRun.mockResolvedValue(value)
    mocks.getToolLoopRun.mockResolvedValue({
      requestId: value.id,
      sessionId: value.sessionId,
      model: "qwen",
      providerId: "ollama"
    })

    const result = await resumeAgentRun(value.id)

    expect(result.run.status).toBe("running")
    expect(result.resume).toEqual({
      requestId: value.id,
      sessionId: value.sessionId,
      model: "qwen",
      providerId: "ollama"
    })
  })

  it("stops, clears pending state, and deletes the checkpoint", async () => {
    const value = {
      ...run(),
      state: {
        ...run().state,
        pendingAction: {
          action: "click" as const,
          snapshotId: "snapshot-1",
          elementId: 1
        }
      }
    }
    mocks.getAgentRun.mockResolvedValue(value)

    const result = await stopAgentRun(value.id)

    expect(result.run.status).toBe("cancelled")
    expect(result.run.state.pendingAction).toBeUndefined()
    expect(mocks.deleteToolLoopRun).toHaveBeenCalledWith(value.id)
    expect(mocks.abort).toHaveBeenCalledWith(value.id)
  })
})
