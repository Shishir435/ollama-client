import { beforeEach, describe, expect, it, vi } from "vitest"

const order = vi.hoisted(() => [] as string[])
const forgetAgentChatRows = vi.hoisted(() =>
  vi.fn(async (_request: unknown) => {
    order.push("forget")
    return { forgotten: true as const }
  })
)

vi.mock("@/lib/feature-flags", () => ({ AGENT_PREVIEW_ENABLED: true }))
vi.mock("@/background/agent/agent-forget-rpc", () => ({ forgetAgentChatRows }))
vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() }
}))
vi.mock("@/lib/repositories/chat-history", () => ({
  deleteSessionRow: vi.fn(async () => void order.push("session")),
  deleteMessagesBySession: vi.fn(async () => void order.push("messages")),
  deleteFilesBySession: vi.fn(async () => void order.push("files"))
}))
vi.mock("@/lib/embeddings/vector-store", () => ({
  deleteVectors: vi.fn(async () => {
    order.push("vectors")
    return 0
  })
}))

import { deleteVectors } from "@/lib/embeddings/vector-store"
import { deleteSessionData } from "../session-delete"

describe("deleteSessionData", () => {
  beforeEach(() => {
    order.length = 0
    vi.clearAllMocks()
  })

  /**
   * The second pass is what makes the race empty rather than small: a run is
   * linked in the same transaction that reads the session, so once the row is
   * gone no further run can claim the chat.
   */
  it("runs the whole delete, stopping runs before and after the row goes", async () => {
    await expect(deleteSessionData({ sessionId: "s-1" })).resolves.toEqual({
      deleted: true
    })
    expect(order).toEqual([
      "forget",
      "session",
      "messages",
      "files",
      "forget",
      "vectors"
    ])
    expect(forgetAgentChatRows).toHaveBeenCalledWith({ sessionId: "s-1" })
    expect(deleteVectors).toHaveBeenCalledWith({
      sessionId: "s-1",
      type: "chat"
    })
  })

  it("still deletes the chat when stopping its runs fails", async () => {
    forgetAgentChatRows.mockRejectedValueOnce(new Error("no receiver"))
    await deleteSessionData({ sessionId: "s-1" })
    expect(order).toContain("session")
    expect(order).toContain("vectors")
  })
})
