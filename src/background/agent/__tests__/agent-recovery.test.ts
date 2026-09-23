import type { AgentRunState } from "@ollama-client/contracts"
import { beforeEach, describe, expect, it, vi } from "vitest"

const repo = vi.hoisted(() => ({
  listAgentRunsForMissingSessions: vi.fn(),
  listIncompleteAgentRuns: vi.fn(),
  markInterruptedAgentEffectUncertain: vi.fn(),
  pruneTerminalAgentRuns: vi.fn(),
  reconcileAgentRunLinkage: vi.fn(),
  transitionAgentRun: vi.fn()
}))

vi.mock("@/lib/repositories/agent-runs", () => repo)

import { recoverAgentRuns, recoverAndPruneAgentRuns } from "../agent-recovery"

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
    repo.listAgentRunsForMissingSessions.mockResolvedValue([])
    repo.reconcileAgentRunLinkage.mockResolvedValue(undefined)
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

  /**
   * Startup reconciliation rewrites linkage rows, so it is a mutation boundary
   * like every other one in the startup chain. Without the signal an aborted
   * startup keeps editing rows the supervisor has already given up on.
   */
  it("threads the startup signal through linkage reconciliation", async () => {
    repo.listIncompleteAgentRuns.mockResolvedValue([])
    const controller = new AbortController()

    await recoverAndPruneAgentRuns(controller.signal)

    expect(repo.reconcileAgentRunLinkage).toHaveBeenCalledWith(
      controller.signal
    )
  })

  /**
   * The signal is checked immediately before each durable write, so an abort
   * mid-cancellation leaves the run `cancelling` — a committed stop the next
   * startup finishes — rather than a run the aborted boot cancelled anyway.
   */
  it("writes no further status once cancellation is aborted", async () => {
    repo.listIncompleteAgentRuns.mockResolvedValue([])
    repo.listAgentRunsForMissingSessions.mockResolvedValue([
      {
        id: "agent-1",
        status: "executing",
        state: state("executing"),
        compacted: false,
        createdAt: 1,
        updatedAt: 2
      }
    ])
    const controller = new AbortController()
    repo.transitionAgentRun.mockImplementationOnce(async (input) => {
      controller.abort()
      return {
        transitioned: true,
        state: { ...state(input.from), ...input.patch, status: input.to }
      }
    })

    await expect(recoverAndPruneAgentRuns(controller.signal)).rejects.toThrow()
    expect(repo.transitionAgentRun).toHaveBeenCalledTimes(1)
    expect(repo.transitionAgentRun).toHaveBeenCalledWith(
      expect.objectContaining({ to: "cancelling" })
    )
    expect(repo.reconcileAgentRunLinkage).not.toHaveBeenCalled()
  })

  it("stops before pruning when reconciliation is aborted", async () => {
    repo.listIncompleteAgentRuns.mockResolvedValue([])
    const controller = new AbortController()
    repo.reconcileAgentRunLinkage.mockImplementation(async () => {
      controller.abort()
      controller.signal.throwIfAborted()
    })

    await expect(recoverAndPruneAgentRuns(controller.signal)).rejects.toThrow()
    expect(repo.pruneTerminalAgentRuns).not.toHaveBeenCalled()
  })
})
