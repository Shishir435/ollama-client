import type { AgentPanelSnapshot } from "@ollama-client/contracts"
import { act, renderHook } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { useAgentRun } from "../use-agent-run"

const posted: unknown[] = []
const messageListeners = new Set<(message: unknown) => void>()
const disconnect = vi.fn()

vi.mock("@/lib/browser-api", () => ({
  browser: {
    runtime: {
      connect: () => ({
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
          addListener: () => undefined,
          removeListener: () => undefined
        }
      })
    }
  }
}))

vi.mock("@/lib/browser-tab-access", () => ({
  queryActiveTab: async () => ({ id: 7, url: "https://example.com/start" })
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

const model = { providerId: "ollama", modelId: "qwen3" }

describe("useAgentRun", () => {
  beforeEach(() => {
    posted.length = 0
    messageListeners.clear()
    disconnect.mockClear()
  })

  it("renders whatever the background last published", () => {
    const { result } = renderHook(() => useAgentRun(model))

    expect(result.current.snapshot).toEqual({ steps: [] })
    act(() => emit(runningSnapshot))
    expect(result.current.snapshot.run?.status).toBe("awaiting_approval")
  })

  it("starts a run on the active tab", async () => {
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

  it("closes the port when the surface unmounts", () => {
    const { unmount } = renderHook(() => useAgentRun(model))

    unmount()

    expect(disconnect).toHaveBeenCalledOnce()
    expect(messageListeners.size).toBe(0)
  })
})
