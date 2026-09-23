import type { AgentRunState } from "@ollama-client/contracts"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { registerAgentAttentionBadge } from "../agent-attention-badge"

const state = (status: AgentRunState["status"]): AgentRunState => ({
  version: 1,
  id: "run-1",
  goal: "Post the review",
  status,
  stepCount: 1,
  observationCount: 1,
  controlledTabId: 7,
  providerId: "ollama",
  modelId: "qwen3",
  allowedOrigins: ["https://example.com"],
  createdAt: 1,
  updatedAt: 1
})

const harness = (initial?: AgentRunState["status"]) => {
  let listener: ((runId: string) => void) | undefined
  let current = initial ? state(initial) : undefined
  const action = {
    setBadgeText: vi.fn(),
    setBadgeBackgroundColor: vi.fn()
  }
  const stop = registerAgentAttentionBadge({
    service: {
      subscribe: (next) => {
        listener = next
        return () => {
          listener = undefined
        }
      },
      latestRunId: async () => (current ? "run-1" : undefined)
    },
    action,
    readRun: async () => current
  })
  return {
    action,
    stop,
    move: async (status: AgentRunState["status"]) => {
      current = state(status)
      listener?.("run-1")
      await vi.advanceTimersByTimeAsync(300)
    }
  }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe("the Agent's toolbar mark", () => {
  /**
   * The gate: an approval parked while the panel is closed must be
   * discoverable without opening the panel on the chance.
   */
  it("marks the icon while a run waits on an approval", async () => {
    const badge = harness("executing")
    await badge.move("awaiting_approval")

    expect(badge.action.setBadgeText).toHaveBeenLastCalledWith({ text: "!" })
  })

  it("marks a run the closing panel paused, and clears once it moves on", async () => {
    const badge = harness("executing")
    await badge.move("paused")
    expect(badge.action.setBadgeText).toHaveBeenLastCalledWith({ text: "!" })

    await badge.move("observing")
    expect(badge.action.setBadgeText).toHaveBeenLastCalledWith({ text: "" })
  })

  /** A worker that restarted onto a parked run has nothing new to announce. */
  it("marks a parked run found at start", async () => {
    const badge = harness("awaiting_takeover")
    await vi.advanceTimersByTimeAsync(0)

    expect(badge.action.setBadgeText).toHaveBeenLastCalledWith({ text: "!" })
  })

  it("coalesces a step's burst of writes into one update", async () => {
    const badge = harness("observing")
    await vi.advanceTimersByTimeAsync(0)
    badge.action.setBadgeText.mockClear()

    await badge.move("deciding")
    await badge.move("executing")

    expect(badge.action.setBadgeText).not.toHaveBeenCalled()
  })

  it("stops listening when disposed", async () => {
    const badge = harness("executing")
    await vi.advanceTimersByTimeAsync(0)
    badge.action.setBadgeText.mockClear()
    badge.stop()

    await badge.move("awaiting_approval")
    expect(badge.action.setBadgeText).not.toHaveBeenCalled()
  })

  /**
   * A rejected update that was remembered anyway would stop the next
   * announcement for the same state from trying again.
   */
  it("tries again after the browser refused an update", async () => {
    const badge = harness("executing")
    await vi.advanceTimersByTimeAsync(0)
    badge.action.setBadgeText.mockClear()
    badge.action.setBadgeText.mockRejectedValueOnce(new Error("busy"))

    await badge.move("awaiting_approval")
    await badge.move("awaiting_approval")

    expect(badge.action.setBadgeText).toHaveBeenCalledTimes(2)
    expect(badge.action.setBadgeText).toHaveBeenLastCalledWith({ text: "!" })
  })

  /**
   * A run parked before the worker restarted announces nothing new, so the
   * startup lookup is the only way its mark comes back — a storage hiccup at
   * start must not lose it.
   */
  it("retries the startup lookup until storage answers, and stops when disposed", async () => {
    const action = { setBadgeText: vi.fn(), setBadgeBackgroundColor: vi.fn() }
    const latestRunId = vi
      .fn<() => Promise<string | undefined>>()
      .mockRejectedValueOnce(new Error("owner not ready"))
      .mockResolvedValue("run-1")
    const stop = registerAgentAttentionBadge({
      service: { subscribe: () => () => undefined, latestRunId },
      action,
      readRun: async () => state("paused")
    })

    await vi.advanceTimersByTimeAsync(0)
    expect(action.setBadgeText).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(action.setBadgeText).toHaveBeenLastCalledWith({ text: "!" })

    const failing = vi.fn(async () => {
      throw new Error("down")
    })
    const stopFailing = registerAgentAttentionBadge({
      service: { subscribe: () => () => undefined, latestRunId: failing },
      action,
      readRun: async () => undefined
    })
    await vi.advanceTimersByTimeAsync(0)
    stopFailing()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(failing).toHaveBeenCalledOnce()
    stop()
  })

  /**
   * The race review found: a run leaves its wait while the earlier "!" is
   * still being set. Run in order, the clear comes last and the icon ends
   * matching the run.
   */
  it("ends on the current state when updates overlap", async () => {
    const badge = harness("executing")
    await vi.advanceTimersByTimeAsync(0)
    badge.action.setBadgeText.mockClear()
    let release: () => void = () => undefined
    badge.action.setBadgeText.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve
        })
    )

    await badge.move("awaiting_approval")
    await badge.move("observing")
    release()
    await vi.advanceTimersByTimeAsync(0)

    expect(badge.action.setBadgeText.mock.calls.map(([call]) => call)).toEqual([
      { text: "!" },
      { text: "" }
    ])
  })
})
