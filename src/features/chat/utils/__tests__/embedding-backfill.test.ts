import { describe, expect, it, vi } from "vitest"
import type { ChatMessage } from "@/types/chat"
import {
  getEmbeddableMessagesBySession,
  isEmbeddableChatMessage
} from "../embedding-backfill"

vi.mock("@/lib/repositories/chat-history", () => ({
  countMessages: vi.fn(),
  getMessagesAfterId: vi.fn(),
  getAllSessions: vi.fn()
}))

describe("isEmbeddableChatMessage", () => {
  it("rejects system messages", () => {
    expect(
      isEmbeddableChatMessage({ role: "system", content: "You are helpful." })
    ).toBe(false)
  })

  it("rejects messages with no content", () => {
    expect(
      isEmbeddableChatMessage({
        role: "user",
        content: undefined
      } as unknown as ChatMessage)
    ).toBe(false)
  })

  it("rejects messages with content shorter than 10 chars", () => {
    expect(isEmbeddableChatMessage({ role: "user", content: "Hi" })).toBe(false)
    expect(
      isEmbeddableChatMessage({ role: "user", content: "123456789" })
    ).toBe(false)
  })

  it("rejects assistant messages where done !== true", () => {
    expect(
      isEmbeddableChatMessage({
        role: "assistant",
        content: "Long enough content here",
        done: false
      })
    ).toBe(false)
    expect(
      isEmbeddableChatMessage({
        role: "assistant",
        content: "Long enough content here"
      })
    ).toBe(false)
  })

  it("accepts user messages with sufficient content", () => {
    expect(
      isEmbeddableChatMessage({
        role: "user",
        content: "This is long enough"
      })
    ).toBe(true)
  })

  it("accepts assistant messages with done=true and sufficient content", () => {
    expect(
      isEmbeddableChatMessage({
        role: "assistant",
        content: "This is the AI response",
        done: true
      })
    ).toBe(true)
  })

  it("rejects whitespace-only content", () => {
    expect(
      isEmbeddableChatMessage({ role: "user", content: "          " })
    ).toBe(false)
  })
})

describe("getEmbeddableMessagesBySession", () => {
  it("groups embeddable messages from SQLite by sessionId", async () => {
    const { countMessages, getMessagesAfterId } =
      await import("@/lib/repositories/chat-history")
    vi.mocked(countMessages).mockResolvedValue(2)
    vi.mocked(getMessagesAfterId).mockResolvedValueOnce([
      { role: "user", content: "Tell me about TypeScript", sessionId: "s1" },
      {
        role: "assistant",
        content: "TypeScript is a typed superset of JavaScript",
        done: true,
        sessionId: "s1"
      },
      { role: "system", content: "You are helpful", sessionId: "s1" }
    ] as never)

    const { messagesBySession, totalMessages } =
      await getEmbeddableMessagesBySession()
    expect(totalMessages).toBe(2)
    expect(messagesBySession.get("s1")).toHaveLength(2)
  })

  it("reads messages a page at a time until a short page", async () => {
    const { countMessages, getMessagesAfterId } =
      await import("@/lib/repositories/chat-history")
    vi.mocked(countMessages).mockResolvedValue(2001)
    const message = {
      role: "user",
      content: "A message long enough to embed",
      sessionId: "s1"
    }
    vi.mocked(getMessagesAfterId)
      .mockResolvedValueOnce(
        Array.from({ length: 2000 }, (_, index) => ({
          ...message,
          id: index + 1
        })) as never
      )
      .mockResolvedValueOnce([{ ...message, id: 2001 }] as never)

    const { totalMessages } = await getEmbeddableMessagesBySession()

    expect(totalMessages).toBe(2001)
    expect(getMessagesAfterId).toHaveBeenNthCalledWith(1, 0, 2000)
    expect(getMessagesAfterId).toHaveBeenNthCalledWith(2, 2000, 2000)
    expect(getMessagesAfterId).toHaveBeenCalledTimes(2)
  })

  it("propagates a page failure instead of returning a partial backfill", async () => {
    const { countMessages, getMessagesAfterId, getAllSessions } =
      await import("@/lib/repositories/chat-history")
    vi.mocked(countMessages).mockResolvedValue(4000)
    vi.mocked(getAllSessions).mockClear()
    vi.mocked(getMessagesAfterId)
      .mockResolvedValueOnce(
        Array.from({ length: 2000 }, (_, index) => ({
          role: "user",
          content: "A message long enough to embed",
          sessionId: "s1",
          id: index + 1
        })) as never
      )
      .mockRejectedValueOnce(new Error("page failed"))

    await expect(getEmbeddableMessagesBySession()).rejects.toThrow(
      "page failed"
    )
    expect(getAllSessions).not.toHaveBeenCalled()
  })

  it("falls back to legacy sessions when SQLite count is 0", async () => {
    const { countMessages, getAllSessions } =
      await import("@/lib/repositories/chat-history")
    vi.mocked(countMessages).mockResolvedValue(0)
    vi.mocked(getAllSessions).mockResolvedValue([
      {
        id: "legacy-1",
        messages: [
          { role: "user", content: "Long enough user message here" },
          {
            role: "assistant",
            content: "Long enough assistant reply",
            done: true
          }
        ]
      }
    ] as never)

    const { messagesBySession, totalMessages } =
      await getEmbeddableMessagesBySession()
    expect(totalMessages).toBe(2)
    expect(messagesBySession.get("legacy-1")).toHaveLength(2)
  })

  it("falls back to legacy sessions when countMessages throws", async () => {
    const { countMessages, getAllSessions } =
      await import("@/lib/repositories/chat-history")
    vi.mocked(countMessages).mockRejectedValue(new Error("DB unavailable"))
    vi.mocked(getAllSessions).mockResolvedValue([
      {
        id: "s2",
        messages: [{ role: "user", content: "Another valid message here" }]
      }
    ] as never)

    const { messagesBySession, totalMessages } =
      await getEmbeddableMessagesBySession()
    expect(totalMessages).toBe(1)
    expect(messagesBySession.has("s2")).toBe(true)
  })

  it("skips messages without sessionId in SQLite path", async () => {
    const { countMessages, getMessagesAfterId } =
      await import("@/lib/repositories/chat-history")
    vi.mocked(countMessages).mockResolvedValue(1)
    vi.mocked(getMessagesAfterId).mockResolvedValueOnce([
      {
        role: "user",
        content: "No session id message here",
        sessionId: undefined
      }
    ] as never)

    const { totalMessages } = await getEmbeddableMessagesBySession()
    expect(totalMessages).toBe(0)
  })
})
