import type { AgentRunCard } from "@ollama-client/contracts/agent-rpc"
import { RpcMethod } from "@ollama-client/contracts/rpc"
import { act, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const call = vi.hoisted(() => vi.fn())

vi.mock("@/protocol/extension-client", () => ({
  extensionRpcClient: { call }
}))

import {
  AGENT_RUN_CARD_REFRESH_MS,
  AGENT_RUN_CARD_RETRY_MS,
  useAgentRunCard
} from "../use-agent-run-card"

const card = (status: AgentRunCard["status"]): AgentRunCard => ({
  id: "run-1",
  goal: "Find the opening hours",
  status,
  stepCount: 2,
  updatedAt: 1
})

/** Let the pending RPC promise and the state update it drives settle. */
const flush = () => act(async () => undefined)

beforeEach(() => {
  vi.useFakeTimers()
  call.mockReset()
})

afterEach(() => {
  vi.useRealTimers()
})

describe("useAgentRunCard", () => {
  it("asks for the run its message names", async () => {
    call.mockResolvedValue({ run: card("completed") })

    const { result } = renderHook(() => useAgentRunCard("run-1"))
    await flush()

    expect(call).toHaveBeenCalledWith(RpcMethod.AgentGetRun, {
      runId: "run-1"
    })
    expect(result.current).toEqual({ kind: "ready", run: card("completed") })
  })

  it("re-reads a live run until it settles, then stops", async () => {
    call
      .mockResolvedValueOnce({ run: card("executing") })
      .mockResolvedValueOnce({ run: card("completed") })

    const { result } = renderHook(() => useAgentRunCard("run-1"))
    await flush()
    expect(result.current).toMatchObject({ run: { status: "executing" } })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(AGENT_RUN_CARD_REFRESH_MS)
    })
    expect(result.current).toMatchObject({ run: { status: "completed" } })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(AGENT_RUN_CARD_REFRESH_MS * 5)
    })
    expect(call).toHaveBeenCalledTimes(2)
  })

  it("reports a run that is gone, and stops asking", async () => {
    call.mockResolvedValue({})

    const { result } = renderHook(() => useAgentRunCard("run-1"))
    await flush()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AGENT_RUN_CARD_RETRY_MS * 2)
    })

    expect(result.current).toEqual({ kind: "missing" })
    expect(call).toHaveBeenCalledTimes(1)
  })

  /**
   * A worker restart drops a read. Blanking the card for it would make every
   * restart flicker every live card in the conversation.
   */
  it("keeps what it showed when a read fails, and asks again later", async () => {
    call
      .mockResolvedValueOnce({ run: card("executing") })
      .mockRejectedValueOnce(new Error("Receiving end does not exist"))
      .mockResolvedValueOnce({ run: card("completed") })

    const { result } = renderHook(() => useAgentRunCard("run-1"))
    await flush()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AGENT_RUN_CARD_REFRESH_MS)
    })
    expect(result.current).toMatchObject({ run: { status: "executing" } })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(AGENT_RUN_CARD_RETRY_MS)
    })
    expect(result.current).toMatchObject({ run: { status: "completed" } })
  })

  it("never asks for a run it has no id for", async () => {
    const { result } = renderHook(() => useAgentRunCard(""))
    await flush()

    expect(result.current).toEqual({ kind: "missing" })
    expect(call).not.toHaveBeenCalled()
  })

  it("stops refreshing once unmounted", async () => {
    call.mockResolvedValue({ run: card("executing") })

    const { unmount } = renderHook(() => useAgentRunCard("run-1"))
    await flush()
    unmount()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AGENT_RUN_CARD_REFRESH_MS * 3)
    })

    expect(call).toHaveBeenCalledTimes(1)
  })
})
