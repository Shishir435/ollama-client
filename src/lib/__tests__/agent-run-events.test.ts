import { beforeEach, describe, expect, it, vi } from "vitest"

const call = vi.hoisted(() => vi.fn())

vi.mock("@/protocol/extension-client", () => ({
  extensionRpcClient: { call }
}))
vi.mock("@/lib/feature-flags", () => ({ AGENT_PREVIEW_ENABLED: true }))

import {
  AgentForgetChatRowsRequestSchema,
  MAX_AGENT_FORGET_MESSAGE_IDS
} from "@ollama-client/contracts/agent-rpc"
import { RpcMethod } from "@ollama-client/contracts/rpc"
import { forgetAgentRuns } from "@/lib/agent-run-events"

describe("agent chat-row forget events", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    call.mockResolvedValue({ forgotten: true })
  })

  /**
   * A deleted subtree has no size limit and the background schema caps one
   * event at ten thousand ids. Sent whole, an oversized event was rejected
   * before the listener saw it — so the largest deletes, the ones most likely
   * to contain a live run, were the ones whose cleanup never ran.
   */
  it("splits a subtree larger than one event into whole events", async () => {
    const messageIds = Array.from({ length: 25_000 }, (_, index) => index)

    await forgetAgentRuns({ messageIds })

    expect(call).toHaveBeenCalledTimes(3)
    const sent = call.mock.calls.map(([method, request]) => {
      expect(method).toBe(RpcMethod.AgentForgetChatRows)
      return request
    })
    for (const event of sent) {
      expect(AgentForgetChatRowsRequestSchema.safeParse(event).success).toBe(
        true
      )
    }
    expect(sent.flatMap((event) => event.messageIds)).toEqual(messageIds)
  })

  it("batches at exactly the cap the background schema enforces", () => {
    const event = (length: number) => ({
      messageIds: Array.from({ length }, (_, index) => index)
    })

    expect(
      AgentForgetChatRowsRequestSchema.safeParse(
        event(MAX_AGENT_FORGET_MESSAGE_IDS)
      ).success
    ).toBe(true)
    expect(
      AgentForgetChatRowsRequestSchema.safeParse(
        event(MAX_AGENT_FORGET_MESSAGE_IDS + 1)
      ).success
    ).toBe(false)
  })

  it("sends one event for a size the schema accepts", async () => {
    await forgetAgentRuns({ messageIds: [1, 2, 3] })

    expect(call).toHaveBeenCalledTimes(1)
    expect(call.mock.calls[0][1]).toMatchObject({
      messageIds: [1, 2, 3]
    })
  })

  it("sends nothing for an empty subtree", async () => {
    await forgetAgentRuns({ messageIds: [] })

    expect(call).not.toHaveBeenCalled()
  })

  /**
   * A batch that fails is logged and the rest are still sent: the work is
   * idempotent per id, so one lost batch costs only its own ids rather than
   * the whole cleanup.
   */
  it("keeps sending after a batch is not delivered", async () => {
    call.mockRejectedValueOnce(new Error("no receiver"))

    await forgetAgentRuns({
      messageIds: Array.from({ length: 15_000 }, (_, index) => index)
    })

    expect(call).toHaveBeenCalledTimes(2)
  })
})
