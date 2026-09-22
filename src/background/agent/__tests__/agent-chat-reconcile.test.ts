import { beforeEach, describe, expect, it, vi } from "vitest"

const listLiveAgentRunsForMessages = vi.fn<
  (ids: number[]) => Promise<string[]>
>(async () => [])
const listLiveAgentRunsForSession = vi.fn<(id: string) => Promise<string[]>>(
  async () => []
)
const orphanAgentRunMessages = vi.fn<(ids: number[]) => Promise<void>>(
  async () => undefined
)
const deleteSettledAgentRunsForSession = vi.fn<(id: string) => Promise<number>>(
  async () => 0
)

vi.mock("@/lib/repositories/agent-runs", () => ({
  listLiveAgentRunsForMessages: (ids: number[]) =>
    listLiveAgentRunsForMessages(ids),
  listLiveAgentRunsForSession: (id: string) => listLiveAgentRunsForSession(id),
  orphanAgentRunMessages: (ids: number[]) => orphanAgentRunMessages(ids),
  deleteSettledAgentRunsForSession: (id: string) =>
    deleteSettledAgentRunsForSession(id)
}))

const {
  applyAgentForgetChatRows,
  AgentForgetChatRowsSchema,
  forgetAgentRunsForMessages,
  forgetAgentRunsForSession
} = await import("../agent-chat-reconcile")

beforeEach(() => {
  vi.clearAllMocks()
  listLiveAgentRunsForMessages.mockResolvedValue([])
  listLiveAgentRunsForSession.mockResolvedValue([])
})

describe("forgetting the runs of deleted chat rows", () => {
  it("stops a live run before dropping its pointers", async () => {
    /*
     * Order is the whole point: a run whose card is gone keeps driving a
     * browser tab and writing to a row nobody can read.
     */
    const order: string[] = []
    listLiveAgentRunsForMessages.mockResolvedValue(["run-1"])
    orphanAgentRunMessages.mockImplementation(async () => {
      order.push("orphan")
      return undefined
    })

    await forgetAgentRunsForMessages([4, 5], async (runId) => {
      order.push(`stop:${runId}`)
    })

    expect(order).toEqual(["stop:run-1", "orphan"])
  })

  it("keeps cleaning up when one run refuses to stop", async () => {
    listLiveAgentRunsForMessages.mockResolvedValue(["run-1", "run-2"])
    const stopped: string[] = []

    await forgetAgentRunsForMessages([4], async (runId) => {
      if (runId === "run-1") throw new Error("detach failed")
      stopped.push(runId)
    })

    expect(stopped).toEqual(["run-2"])
    expect(orphanAgentRunMessages).toHaveBeenCalledWith([4])
  })

  it("does nothing for an empty deletion", async () => {
    await forgetAgentRunsForMessages([], vi.fn())
    expect(listLiveAgentRunsForMessages).not.toHaveBeenCalled()
    expect(orphanAgentRunMessages).not.toHaveBeenCalled()
  })

  it("deletes the runs of a deleted chat, receipts included", async () => {
    listLiveAgentRunsForSession.mockResolvedValueOnce(["run-9"])
    listLiveAgentRunsForSession.mockResolvedValueOnce([])
    const stop = vi.fn<(runId: string) => Promise<void>>(async () => undefined)

    await forgetAgentRunsForSession("s-1", stop)

    expect(stop).toHaveBeenCalledWith("run-9")
    expect(deleteSettledAgentRunsForSession).toHaveBeenCalledWith("s-1")
  })

  it("re-reads rather than trusting a stop that did not throw", async () => {
    /*
     * A stop that returned is not proof the run settled. Deleting its row
     * would take away the one handle startup recovery has for reaching an
     * agent that is still attached to a browser.
     */
    listLiveAgentRunsForSession.mockResolvedValue(["run-stuck"])

    await forgetAgentRunsForSession("s-1", async () => undefined)

    expect(listLiveAgentRunsForSession).toHaveBeenCalledTimes(2)
    expect(deleteSettledAgentRunsForSession).toHaveBeenCalledWith("s-1")
  })
})

describe("the forget event", () => {
  it("accepts one shape or the other, never both", () => {
    expect(
      AgentForgetChatRowsSchema.safeParse({
        type: "agent-forget-chat-rows",
        sessionId: "s-1"
      }).success
    ).toBe(true)
    expect(
      AgentForgetChatRowsSchema.safeParse({
        type: "agent-forget-chat-rows",
        sessionId: "s-1",
        messageIds: [1]
      }).success
    ).toBe(false)
    expect(
      AgentForgetChatRowsSchema.safeParse({
        type: "agent-forget-chat-rows"
      }).success
    ).toBe(false)
  })

  it("routes a session event to the cascading cleanup", async () => {
    await applyAgentForgetChatRows(
      { type: "agent-forget-chat-rows", sessionId: "s-2" },
      vi.fn(async () => undefined)
    )
    expect(deleteSettledAgentRunsForSession).toHaveBeenCalledWith("s-2")
    expect(orphanAgentRunMessages).not.toHaveBeenCalled()
  })

  it("routes a message event to the keeping cleanup", async () => {
    await applyAgentForgetChatRows(
      { type: "agent-forget-chat-rows", messageIds: [7] },
      vi.fn(async () => undefined)
    )
    expect(orphanAgentRunMessages).toHaveBeenCalledWith([7])
    expect(deleteSettledAgentRunsForSession).not.toHaveBeenCalled()
  })
})
