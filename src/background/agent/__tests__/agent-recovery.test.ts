import type { AgentRunState } from "@ollama-client/contracts"
import { beforeEach, describe, expect, it, vi } from "vitest"

const repo = vi.hoisted(() => ({
  listIncompleteAgentRuns: vi.fn(),
  markInterruptedAgentEffectUncertain: vi.fn(),
  pruneTerminalAgentRuns: vi.fn(),
  transitionAgentRun: vi.fn()
}))

vi.mock("@/lib/repositories/agent-runs", () => repo)

import { recoverAgentRuns } from "../agent-recovery"

const state = (status: AgentRunState["status"]): AgentRunState => ({
  version: 1,
  id: "agent-1",
  goal: "Inspect the page",
  status,
  stepCount: 1,
  observationCount: 1,
  controlledTabId: 7,
  providerId: "ollama",
  modelId: "model",
  allowedOrigins: ["https://example.com"],
  createdAt: 1,
  updatedAt: 2
})

describe("agent startup recovery", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    repo.pruneTerminalAgentRuns.mockResolvedValue(0)
    repo.markInterruptedAgentEffectUncertain.mockResolvedValue(false)
    repo.transitionAgentRun.mockImplementation(async (input) => ({
      transitioned: true,
      state: { ...state(input.from), ...input.patch, status: input.to }
    }))
  })

  it.each([
    "executing",
    "verifying"
  ] as const)("marks %s effects uncertain and never resumes work", async (status) => {
    repo.listIncompleteAgentRuns.mockResolvedValueOnce([
      {
        id: "agent-1",
        status,
        state: state(status),
        compacted: false,
        createdAt: 1,
        updatedAt: 2
      }
    ])
    repo.markInterruptedAgentEffectUncertain.mockResolvedValue(true)
    repo.listIncompleteAgentRuns.mockResolvedValueOnce([
      {
        id: "agent-1",
        status: "pause_requested",
        state: {
          ...state("pause_requested"),
          pauseReason: "unresolved_effect"
        },
        compacted: false,
        createdAt: 1,
        updatedAt: 3
      }
    ])

    await recoverAgentRuns()

    expect(repo.markInterruptedAgentEffectUncertain).toHaveBeenCalledWith(
      "agent-1",
      expect.any(Number)
    )
    expect(repo.transitionAgentRun).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "pause_requested",
        to: "paused",
        patch: expect.objectContaining({ pauseReason: "unresolved_effect" })
      })
    )
  })

  it("settles cancelling without invoking any run work", async () => {
    repo.listIncompleteAgentRuns.mockResolvedValue([
      {
        id: "agent-1",
        status: "cancelling",
        state: state("cancelling"),
        compacted: false,
        createdAt: 1,
        updatedAt: 2
      }
    ])

    await recoverAgentRuns()

    expect(repo.transitionAgentRun).toHaveBeenCalledWith(
      expect.objectContaining({ from: "cancelling", to: "cancelled" })
    )
    expect(repo.markInterruptedAgentEffectUncertain).not.toHaveBeenCalled()
  })

  it("pauses safe phases for an explicit side-panel resume", async () => {
    repo.listIncompleteAgentRuns.mockResolvedValue([
      {
        id: "agent-1",
        status: "deciding",
        state: state("deciding"),
        compacted: false,
        createdAt: 1,
        updatedAt: 2
      }
    ])

    await recoverAgentRuns()

    expect(repo.transitionAgentRun).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        from: "deciding",
        to: "pause_requested",
        patch: expect.objectContaining({ pauseReason: "panel_closed" })
      })
    )
    expect(repo.transitionAgentRun).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ from: "pause_requested", to: "paused" })
    )
  })
})
