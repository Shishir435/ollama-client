import { beforeEach, describe, expect, it, vi } from "vitest"

const applyAgentForgetChatRows = vi.hoisted(() =>
  vi.fn(async (_request: unknown, _stop: unknown) => undefined)
)

vi.mock("../agent-chat-reconcile", () => ({ applyAgentForgetChatRows }))

import { forgetAgentChatRows, setAgentForgetStopper } from "../agent-forget-rpc"

describe("the forget RPC handler", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setAgentForgetStopper(undefined)
  })

  it("stops runs through the service the composition handed over", async () => {
    const stop = vi.fn(async () => undefined)
    setAgentForgetStopper(stop)

    await expect(forgetAgentChatRows({ sessionId: "s-1" })).resolves.toEqual({
      forgotten: true
    })

    const [, passed] = applyAgentForgetChatRows.mock.calls[0]
    expect(passed).toBe(stop)
  })

  /**
   * Before the composition exists no run of this worker can be live, so the
   * delete is answered rather than failed, and a row a previous worker left
   * live stays where startup recovery will settle it.
   */
  it("answers without a service instead of failing the delete", async () => {
    await expect(forgetAgentChatRows({ messageIds: [3] })).resolves.toEqual({
      forgotten: true
    })

    const [request, passed] = applyAgentForgetChatRows.mock.calls[0]
    expect(request).toEqual({ messageIds: [3] })
    await expect(
      (passed as (id: string) => Promise<void>)("r-1")
    ).resolves.toBeUndefined()
  })
})
