import { describe, expect, it, vi } from "vitest"
import {
  resolveToolLoopState,
  ToolLoopCoordinator,
  type ToolLoopState
} from "../tool-loop-runtime"

type Message = { role: string; content: string }
type Run = {
  callId?: string
  status: string
  completedAt?: number
  error?: string
}
type Call = { id: string; parallel: boolean; untrusted?: boolean }
type State = ToolLoopState<Message, Run, Call, { tokens: number }>

const makeState = (): State => ({
  iteration: 0,
  phase: "model",
  taintGeneration: 0,
  workingMessages: [{ role: "user", content: "hello" }],
  toolRuns: []
})

describe("ToolLoopCoordinator", () => {
  it("reuses a restored state and checkpoints approval boundaries", async () => {
    const restored = makeState()
    const writer = vi.fn().mockResolvedValue(undefined)
    const state = resolveToolLoopState(restored, makeState)
    const coordinator = new ToolLoopCoordinator(state, writer)

    coordinator.setMetrics({ tokens: 4 })
    await coordinator.checkpoint(true)

    expect(state).toBe(restored)
    expect(writer).toHaveBeenCalledWith(restored, true)
    expect(restored.lastMetrics).toEqual({ tokens: 4 })
  })

  it("enters and completes native tool phases consistently", async () => {
    const writer = vi.fn().mockResolvedValue(undefined)
    const state = makeState()
    const coordinator = new ToolLoopCoordinator(state, writer)
    const calls = [{ id: "call-1", parallel: false }]

    await coordinator.enterTools(calls, "native")
    state.toolResultMessages?.push({ role: "tool", content: "result" })
    await coordinator.completeToolPhase(() => {
      state.workingMessages.push(...(state.toolResultMessages ?? []))
    })

    expect(state).toMatchObject({ iteration: 1, phase: "model" })
    expect(state.workingMessages.at(-1)).toEqual({
      role: "tool",
      content: "result"
    })
    expect(state.pendingToolCalls).toBeUndefined()
    expect(state.nextToolIndex).toBeUndefined()
    expect(writer).toHaveBeenCalledTimes(2)
  })

  it("preserves order across parallel groups and advances taint", async () => {
    const state = makeState()
    state.phase = "tools"
    state.pendingToolCalls = [
      { id: "a", parallel: true, untrusted: true },
      { id: "b", parallel: true },
      { id: "c", parallel: false }
    ]
    state.nextToolIndex = 0
    const checkpoints: number[] = []
    const coordinator = new ToolLoopCoordinator(state, async (value) => {
      checkpoints.push(value.nextToolIndex ?? -1)
    })
    const collected: string[] = []
    const preparedAt: Array<{ id: string; taint: number }> = []

    await coordinator.executePendingTools({
      prepare: async (call, taint) => {
        preparedAt.push({ id: call.id, taint })
        return {
          call,
          policy: { parallelizable: call.parallel },
          authorizationSensitive: false
        }
      },
      canJoinParallelGroup: async (call) => call.parallel,
      start: vi.fn(),
      execute: async ({ call }) => ({
        id: call.id,
        provenance: call.untrusted
          ? ("web-untrusted" as const)
          : ("trusted" as const)
      }),
      collect: (result) => collected.push(result.id)
    })

    expect(collected).toEqual(["a", "b", "c"])
    expect(checkpoints).toEqual([2, 3])
    expect(state.taintGeneration).toBe(1)
    expect(preparedAt).toEqual([
      { id: "a", taint: 0 },
      { id: "b", taint: 0 },
      { id: "c", taint: 1 }
    ])
  })

  it("reuses a persisted run instead of duplicating it", () => {
    const state = makeState()
    state.toolRuns.push({
      callId: "call-1",
      status: "awaiting-confirmation",
      completedAt: 4,
      error: "stale"
    })
    const coordinator = new ToolLoopCoordinator(state)

    const run = coordinator.reuseOrAddToolRun({
      callId: "call-1",
      status: "pending"
    })

    expect(state.toolRuns).toHaveLength(1)
    expect(run).toEqual({ callId: "call-1", status: "running" })
  })
})
