import { beforeEach, describe, expect, it, vi } from "vitest"

const sendMessage = vi.hoisted(() => vi.fn())

vi.mock("@/lib/browser-api", () => ({
  browser: { runtime: { sendMessage } }
}))
vi.mock("@/lib/feature-flags", () => ({ AGENT_PREVIEW_ENABLED: true }))

import { AgentForgetChatRowsSchema } from "@/background/agent/agent-chat-reconcile"
import { forgetAgentRuns } from "@/lib/agent-run-events"

describe("agent chat-row forget events", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sendMessage.mockResolvedValue(undefined)
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

    expect(sendMessage).toHaveBeenCalledTimes(3)
    const sent = sendMessage.mock.calls.map(([event]) => event)
    for (const event of sent) {
      expect(AgentForgetChatRowsSchema.safeParse(event).success).toBe(true)
    }
    expect(sent.flatMap((event) => event.messageIds)).toEqual(messageIds)
  })

  it("sends one event for a size the schema accepts", async () => {
    await forgetAgentRuns({ messageIds: [1, 2, 3] })

    expect(sendMessage).toHaveBeenCalledTimes(1)
    expect(sendMessage.mock.calls[0][0]).toMatchObject({
      messageIds: [1, 2, 3]
    })
  })

  it("sends nothing for an empty subtree", async () => {
    await forgetAgentRuns({ messageIds: [] })

    expect(sendMessage).not.toHaveBeenCalled()
  })

  /**
   * A batch that fails is logged and the rest are still sent: the work is
   * idempotent per id, so one lost batch costs only its own ids rather than
   * the whole cleanup.
   */
  it("keeps sending after a batch is not delivered", async () => {
    sendMessage.mockRejectedValueOnce(new Error("no receiver"))

    await forgetAgentRuns({
      messageIds: Array.from({ length: 15_000 }, (_, index) => index)
    })

    expect(sendMessage).toHaveBeenCalledTimes(2)
  })
})
