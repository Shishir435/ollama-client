import type { AgentPanelSnapshot } from "@ollama-client/contracts"
import { act, renderHook } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { useAgentRun } from "../use-agent-run"

vi.mock("@/lib/feature-flags", () => ({ AGENT_DEBUG_REPORT_ENABLED: true }))

const posted: unknown[] = []
const messageListeners = new Set<(message: unknown) => void>()
const disconnectListeners = new Set<() => void>()
const disconnect = vi.fn()
const connect = vi.fn(() => ({
  postMessage: (message: unknown) => posted.push(message),
  disconnect,
  onMessage: {
    addListener: (listener: (message: unknown) => void) => {
      messageListeners.add(listener)
    },
    removeListener: (listener: (message: unknown) => void) => {
      messageListeners.delete(listener)
    }
  },
  onDisconnect: {
    addListener: (listener: () => void) => {
      disconnectListeners.add(listener)
    },
    removeListener: (listener: () => void) => {
      disconnectListeners.delete(listener)
    }
  }
}))

vi.mock("@/lib/browser-api", () => ({
  browser: { runtime: { connect: () => connect() } }
}))

const requestPerception = vi.fn(async () => true)

vi.mock("@/lib/permissions", () => ({
  requestAgentPerceptionPermission: () => requestPerception()
}))

const emit = (snapshot: AgentPanelSnapshot) => {
  for (const listener of messageListeners) {
    listener({ type: "agent_snapshot", version: 1, snapshot })
  }
}

const runningSnapshot: AgentPanelSnapshot = {
  run: {
    version: 1,
    id: "run-1",
    goal: "Find the pricing page",
    status: "awaiting_approval",
    stepCount: 1,
    observationCount: 2,
    controlledTabId: 7,
    providerId: "ollama",
    modelId: "qwen3",
    allowedOrigins: ["https://example.com"],
    createdAt: 1,
    updatedAt: 2
  },
  steps: [],
  pending: {
    kind: "approval",
    request: {
      id: "approval-1",
      runId: "run-1",
      stepId: "step-1",
      risk: "high",
      action: "Submit the order form",
      consequence: "Places an order",
      createdAt: 2
    }
  }
}

const model = { providerId: "ollama", modelId: "qwen3", tabId: 7 }

describe("useAgentRun", () => {
  beforeEach(() => {
    posted.length = 0
    messageListeners.clear()
    disconnectListeners.clear()
    disconnect.mockClear()
    connect.mockClear()
    requestPerception.mockClear()
    requestPerception.mockResolvedValue(true)
  })

  it("reads historical debug reports through a correlated background request", async () => {
    const hook = renderHook(() => useAgentRun(model))
    const pending = hook.result.current.debugReport("historical-run")
    const command = posted[0] as {
      type: string
      requestId: string
      runId: string
    }
    expect(command).toMatchObject({
      type: "agent_debug_report",
      runId: "historical-run"
    })
    for (const listener of messageListeners)
      listener({
        type: "agent_debug_report",
        version: 1,
        requestId: "unrelated",
        report: "wrong"
      })
    expect(disconnect).not.toHaveBeenCalled()
    for (const listener of messageListeners)
      listener({
        type: "agent_debug_report",
        version: 1,
        requestId: command.requestId,
        report: "historical record"
      })
    await expect(pending).resolves.toBe("historical record")
    expect(disconnect).not.toHaveBeenCalled()
    expect(messageListeners.size).toBe(1)
    hook.unmount()
    expect(disconnect).toHaveBeenCalledOnce()
  })

  it("cleans up pending debug reads when the panel closes", async () => {
    const controller = new AbortController()
    const hook = renderHook(() => useAgentRun(model))
    const pending = hook.result.current.debugReport(
      undefined,
      controller.signal
    )
    controller.abort()
    await expect(pending).rejects.toThrow("panel closed")
    expect(disconnect).not.toHaveBeenCalled()
    expect(messageListeners.size).toBe(1)
    hook.unmount()
  })

  it("refreshes only supervised active runs and stops the heartbeat on unmount", async () => {
    vi.useFakeTimers()
    const hook = renderHook(() => useAgentRun(model))
    try {
      act(() => emit(runningSnapshot))
      act(() => vi.advanceTimersByTime(20_000))
      expect(posted).toContainEqual({ type: "agent_refresh" })
      posted.length = 0
      hook.unmount()
      act(() => vi.advanceTimersByTime(20_000))
      expect(posted).toEqual([])
    } finally {
      vi.useRealTimers()
    }
  })

  it("renders whatever the background last published", () => {
    const { result } = renderHook(() => useAgentRun(model))

    expect(result.current.snapshot).toEqual({ steps: [] })
    act(() => emit(runningSnapshot))
    expect(result.current.snapshot.run?.status).toBe("awaiting_approval")
  })

  it("starts a run on the exact tab displayed by the panel", async () => {
    const { result } = renderHook(() => useAgentRun(model))

    await act(async () => {
      result.current.start("  Find the pricing page  ")
      await Promise.resolve()
    })

    expect(posted).toEqual([
      {
        type: "agent_start",
        goal: "Find the pricing page",
        tabId: 7,
        providerId: "ollama",
        modelId: "qwen3",
        allowExperimentalModel: undefined
      }
    ])
  })

  it("asks for page-observation permission before it starts anything", async () => {
    requestPerception.mockResolvedValue(false)
    const { result } = renderHook(() => useAgentRun(model))

    await act(async () => {
      result.current.start("Find the pricing page")
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(requestPerception).toHaveBeenCalledOnce()
    expect(posted).toEqual([])
    expect(result.current.failure?.messageKey).toBe(
      "agent.error.permission_denied"
    )
  })

  it("sends nothing without a model or a goal", async () => {
    const { result } = renderHook(() => useAgentRun({}))

    await act(async () => {
      result.current.start("Find the pricing page")
      await Promise.resolve()
    })
    expect(posted).toEqual([])

    const withModel = renderHook(() => useAgentRun(model))
    await act(async () => {
      withModel.result.current.start("   ")
      await Promise.resolve()
    })
    expect(posted).toEqual([])
  })

  it("answers the request the snapshot is showing", () => {
    const { result } = renderHook(() => useAgentRun(model))
    act(() => emit(runningSnapshot))

    act(() => result.current.approve())

    expect(posted).toEqual([
      {
        type: "agent_approve",
        runId: "run-1",
        requestId: "approval-1"
      }
    ])
  })

  it("answers nothing when no request is parked", () => {
    const { result } = renderHook(() => useAgentRun(model))
    act(() => emit({ ...runningSnapshot, pending: undefined }))

    act(() => result.current.approve())
    act(() => result.current.beginTakeover())

    expect(posted).toEqual([])
  })

  it("surfaces a refusal by key and clears it on the next command", () => {
    const { result } = renderHook(() => useAgentRun(model))
    act(() => emit(runningSnapshot))

    act(() => {
      for (const listener of messageListeners) {
        listener({
          type: "agent_command_failed",
          version: 1,
          command: "agent_start",
          messageKey: "agent.error.tab_unsupported",
          message: "Agent cannot run on this page."
        })
      }
    })
    expect(result.current.failure?.messageKey).toBe(
      "agent.error.tab_unsupported"
    )

    act(() => result.current.stop())
    expect(result.current.failure).toBeUndefined()
  })

  it("discards a message the contract does not describe", () => {
    const { result } = renderHook(() => useAgentRun(model))
    act(() => emit(runningSnapshot))

    act(() => {
      for (const listener of messageListeners) {
        listener({ type: "agent_snapshot", version: 99, snapshot: {} })
      }
    })

    expect(result.current.snapshot.run?.id).toBe("run-1")
  })

  it("reconnects after the background worker drops the port", () => {
    vi.useFakeTimers()
    try {
      renderHook(() => useAgentRun(model))
      expect(connect).toHaveBeenCalledOnce()

      act(() => {
        for (const listener of [...disconnectListeners]) listener()
      })
      act(() => {
        vi.advanceTimersByTime(1_000)
      })

      expect(connect).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it("stops reconnecting once the surface unmounts", () => {
    vi.useFakeTimers()
    try {
      const { unmount } = renderHook(() => useAgentRun(model))
      unmount()

      act(() => {
        for (const listener of [...disconnectListeners]) listener()
      })
      act(() => {
        vi.advanceTimersByTime(10_000)
      })

      expect(connect).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
  })

  it("closes the port when the surface unmounts", () => {
    const { unmount } = renderHook(() => useAgentRun(model))

    unmount()

    expect(disconnect).toHaveBeenCalledOnce()
    expect(messageListeners.size).toBe(0)
  })
})
