import { beforeEach, describe, expect, it, vi } from "vitest"
import * as repo from "@/lib/repositories/chat-history"
import { chatSessionStore } from "../chat-session-store"

vi.mock("@/lib/repositories/chat-history")
vi.mock("@/lib/embeddings/vector-store", () => ({
  deleteVectors: vi.fn().mockResolvedValue(0)
}))
vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() }
}))

const mockRepo = vi.mocked(repo)

// Import deleteVectors after mocking so we get the mock instance
import { deleteVectors } from "@/lib/embeddings/vector-store"

const SESSION_ID = "session-abc"

/** Minimal helpers to avoid repeating loadSessionMessages dependencies */
function setupLoadSessionMessagesMocks(
  messages: unknown[] = [],
  session: unknown = { id: SESSION_ID, title: "Test", currentLeafId: undefined }
) {
  mockRepo.getSession.mockResolvedValue(session as any)
  mockRepo.getMessagesBySessionOrderedByTimestamp.mockResolvedValue(
    messages as any
  )
  mockRepo.getFilesByMessageIds.mockResolvedValue([])
}

function resetStore() {
  chatSessionStore.setState({
    sessions: [],
    currentSessionId: null,
    hasSession: false,
    hydrated: false,
    highlightedMessage: null,
    hasMoreMessages: false
  })
}

beforeEach(() => {
  resetStore()
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// addMessage
// ---------------------------------------------------------------------------

describe("addMessage", () => {
  it("atomically appends a message with the correct shape", async () => {
    mockRepo.appendMessage.mockResolvedValue(99)
    setupLoadSessionMessagesMocks()

    chatSessionStore.setState({
      sessions: [
        {
          id: SESSION_ID,
          title: "T",
          createdAt: 1,
          updatedAt: 1,
          messages: [],
          currentLeafId: undefined
        }
      ],
      currentSessionId: SESSION_ID
    })

    const message = {
      role: "user" as const,
      content: "hello",
      timestamp: 1000
    }
    await chatSessionStore.getState().addMessage(SESSION_ID, message as any)

    expect(mockRepo.appendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: SESSION_ID,
        role: "user",
        content: "hello",
        timestamp: 1000
      }),
      [],
      expect.objectContaining({ id: SESSION_ID })
    )
  })

  it("updates local leaf state after the atomic append", async () => {
    mockRepo.appendMessage.mockResolvedValue(42)
    setupLoadSessionMessagesMocks(
      [{ id: 42, role: "user", content: "hi", timestamp: 2 }],
      { id: SESSION_ID, title: "Test", currentLeafId: 42 }
    )

    chatSessionStore.setState({
      sessions: [
        {
          id: SESSION_ID,
          title: "T",
          createdAt: 1,
          updatedAt: 1,
          messages: [],
          currentLeafId: undefined
        }
      ],
      currentSessionId: SESSION_ID
    })

    await chatSessionStore
      .getState()
      .addMessage(SESSION_ID, { role: "user", content: "hi" } as any)

    expect(mockRepo.appendMessage).toHaveBeenCalledOnce()
    expect(chatSessionStore.getState().sessions[0]?.currentLeafId).toBe(42)
  })

  it("includes attachments in the atomic append", async () => {
    mockRepo.appendMessage.mockResolvedValue(10)
    setupLoadSessionMessagesMocks()

    chatSessionStore.setState({
      sessions: [
        {
          id: SESSION_ID,
          title: "T",
          createdAt: 1,
          updatedAt: 1,
          messages: [],
          currentLeafId: undefined
        }
      ],
      currentSessionId: SESSION_ID
    })

    const attachment = {
      fileId: "f1",
      fileType: "image/png",
      fileName: "photo.png",
      fileSize: 100,
      data: new Uint8Array([1])
    }
    await chatSessionStore.getState().addMessage(SESSION_ID, {
      role: "user",
      content: "pic",
      attachments: [attachment]
    } as any)

    expect(mockRepo.appendMessage).toHaveBeenCalledWith(
      expect.anything(),
      expect.arrayContaining([
        expect.objectContaining({
          fileId: "f1",
          sessionId: SESSION_ID
        })
      ]),
      expect.objectContaining({ id: SESSION_ID })
    )
  })

  it("calls loadSessionMessages after adding (repo.getSession is called)", async () => {
    mockRepo.appendMessage.mockResolvedValue(5)
    setupLoadSessionMessagesMocks()

    chatSessionStore.setState({
      sessions: [
        {
          id: SESSION_ID,
          title: "T",
          createdAt: 1,
          updatedAt: 1,
          messages: [],
          currentLeafId: undefined
        }
      ],
      currentSessionId: SESSION_ID
    })

    await chatSessionStore
      .getState()
      .addMessage(SESSION_ID, { role: "user", content: "x" } as any)

    expect(mockRepo.getSession).toHaveBeenCalledWith(SESSION_ID)
  })

  it("uses last message id as parentId when currentLeafId is not set", async () => {
    mockRepo.appendMessage.mockResolvedValue(7)
    setupLoadSessionMessagesMocks()

    chatSessionStore.setState({
      sessions: [
        {
          id: SESSION_ID,
          title: "T",
          createdAt: 1,
          updatedAt: 1,
          currentLeafId: undefined,
          messages: [{ id: 55, role: "user" as const, content: "prev" }]
        }
      ],
      currentSessionId: SESSION_ID
    })

    await chatSessionStore
      .getState()
      .addMessage(SESSION_ID, { role: "assistant", content: "resp" } as any)

    expect(mockRepo.appendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ parentId: 55 }),
      [],
      expect.objectContaining({ id: SESSION_ID })
    )
  })

  it("keeps the optimistic message when post-save refresh fails", async () => {
    mockRepo.appendMessage.mockResolvedValue(8)
    mockRepo.getSession.mockRejectedValue(new Error("read failed"))

    chatSessionStore.setState({
      sessions: [
        {
          id: SESSION_ID,
          title: "T",
          createdAt: 1,
          updatedAt: 1,
          messages: []
        }
      ],
      currentSessionId: SESSION_ID
    })

    await expect(
      chatSessionStore
        .getState()
        .addMessage(SESSION_ID, { role: "user", content: "saved" } as any)
    ).resolves.toBe(8)

    expect(chatSessionStore.getState().sessions[0]?.messages).toEqual([
      expect.objectContaining({ id: 8, content: "saved" })
    ])
  })
})

// ---------------------------------------------------------------------------
// updateMessage
// ---------------------------------------------------------------------------

describe("updateMessage", () => {
  beforeEach(() => {
    chatSessionStore.setState({
      sessions: [
        {
          id: SESSION_ID,
          title: "T",
          createdAt: 1,
          updatedAt: 1,
          messages: [{ id: 11, role: "user" as const, content: "original" }],
          currentLeafId: 11
        }
      ],
      currentSessionId: SESSION_ID
    })
  })

  it("calls repo.updateMessage when skipDb=false (default)", async () => {
    mockRepo.updateMessage.mockResolvedValue(undefined as any)

    await chatSessionStore
      .getState()
      .updateMessage(11, { content: "updated" }, false)

    expect(mockRepo.updateMessage).toHaveBeenCalledWith(11, {
      content: "updated"
    })
  })

  it("does NOT call repo.updateMessage when skipDb=true", async () => {
    await chatSessionStore
      .getState()
      .updateMessage(11, { content: "skip" }, true)

    expect(mockRepo.updateMessage).not.toHaveBeenCalled()
  })

  it("updates the message content in store state", async () => {
    mockRepo.updateMessage.mockResolvedValue(undefined as any)

    await chatSessionStore
      .getState()
      .updateMessage(11, { content: "new content" }, false)

    const session = chatSessionStore
      .getState()
      .sessions.find((s) => s.id === SESSION_ID)
    const msg = session?.messages?.find((m) => m.id === 11)
    expect(msg?.content).toBe("new content")
  })

  it("calls deleteVectors when content changes (skipDb=false)", async () => {
    mockRepo.updateMessage.mockResolvedValue(undefined as any)
    vi.mocked(deleteVectors).mockResolvedValue(0)

    await chatSessionStore
      .getState()
      .updateMessage(11, { content: "changed" }, false)

    // deleteVectors is called asynchronously — flush microtasks
    await Promise.resolve()
    expect(deleteVectors).toHaveBeenCalledWith({ messageId: 11 })
  })
})

// ---------------------------------------------------------------------------
// forkMessage
// ---------------------------------------------------------------------------

describe("forkMessage", () => {
  it("calls repo.getMessage to get the original message", async () => {
    mockRepo.getMessage.mockResolvedValue({
      id: 20,
      role: "user",
      content: "original",
      sessionId: SESSION_ID,
      parentId: 10,
      model: "llama3"
    } as any)
    mockRepo.appendMessage.mockResolvedValue(21)
    setupLoadSessionMessagesMocks()

    chatSessionStore.setState({
      sessions: [
        {
          id: SESSION_ID,
          title: "T",
          createdAt: 1,
          updatedAt: 1,
          messages: [],
          currentLeafId: 20
        }
      ],
      currentSessionId: SESSION_ID
    })

    await chatSessionStore.getState().forkMessage(SESSION_ID, 20, "forked")

    expect(mockRepo.getMessage).toHaveBeenCalledWith(20)
  })

  it("atomically appends the fork with the original parent and role", async () => {
    mockRepo.getMessage.mockResolvedValue({
      id: 20,
      role: "user",
      content: "original",
      sessionId: SESSION_ID,
      parentId: 10,
      model: "llama3"
    } as any)
    mockRepo.appendMessage.mockResolvedValue(21)
    setupLoadSessionMessagesMocks()

    chatSessionStore.setState({
      sessions: [
        {
          id: SESSION_ID,
          title: "T",
          createdAt: 1,
          updatedAt: 1,
          messages: [],
          currentLeafId: 20
        }
      ],
      currentSessionId: SESSION_ID
    })

    await chatSessionStore.getState().forkMessage(SESSION_ID, 20, "forked")

    expect(mockRepo.appendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        role: "user",
        content: "forked",
        parentId: 10,
        sessionId: SESSION_ID
      }),
      [],
      expect.objectContaining({ id: SESSION_ID })
    )
  })

  it("returns the id from the atomic fork append", async () => {
    mockRepo.getMessage.mockResolvedValue({
      id: 20,
      role: "user",
      content: "original",
      sessionId: SESSION_ID,
      parentId: 10,
      model: "llama3"
    } as any)
    mockRepo.appendMessage.mockResolvedValue(21)
    setupLoadSessionMessagesMocks()

    chatSessionStore.setState({
      sessions: [
        {
          id: SESSION_ID,
          title: "T",
          createdAt: 1,
          updatedAt: 1,
          messages: [],
          currentLeafId: 20
        }
      ],
      currentSessionId: SESSION_ID
    })

    await expect(
      chatSessionStore.getState().forkMessage(SESSION_ID, 20, "forked")
    ).resolves.toBe(21)
  })

  it("returns the new message id", async () => {
    mockRepo.getMessage.mockResolvedValue({
      id: 20,
      role: "user",
      content: "original",
      sessionId: SESSION_ID,
      parentId: 10,
      model: "llama3"
    } as any)
    mockRepo.appendMessage.mockResolvedValue(99)
    setupLoadSessionMessagesMocks()

    chatSessionStore.setState({
      sessions: [
        {
          id: SESSION_ID,
          title: "T",
          createdAt: 1,
          updatedAt: 1,
          messages: [],
          currentLeafId: 20
        }
      ],
      currentSessionId: SESSION_ID
    })

    const newId = await chatSessionStore
      .getState()
      .forkMessage(SESSION_ID, 20, "forked")

    expect(newId).toBe(99)
  })

  it("returns undefined when original message is not found", async () => {
    mockRepo.getMessage.mockResolvedValue(undefined as any)

    chatSessionStore.setState({
      sessions: [
        {
          id: SESSION_ID,
          title: "T",
          createdAt: 1,
          updatedAt: 1,
          messages: [],
          currentLeafId: undefined
        }
      ],
      currentSessionId: SESSION_ID
    })

    const result = await chatSessionStore
      .getState()
      .forkMessage(SESSION_ID, 999, "forked")

    expect(result).toBeUndefined()
    expect(mockRepo.addMessage).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// navigateToNode
// ---------------------------------------------------------------------------

describe("navigateToNode", () => {
  beforeEach(() => {
    mockRepo.updateSession.mockResolvedValue(undefined as any)
    setupLoadSessionMessagesMocks()
    chatSessionStore.setState({
      sessions: [
        {
          id: SESSION_ID,
          title: "T",
          createdAt: 1,
          updatedAt: 1,
          messages: [],
          currentLeafId: undefined
        }
      ],
      currentSessionId: SESSION_ID
    })
  })

  it("calls repo.updateSession with nodeId when exact=true", async () => {
    await chatSessionStore.getState().navigateToNode(SESSION_ID, 30, true)

    expect(mockRepo.updateSession).toHaveBeenCalledWith(SESSION_ID, {
      currentLeafId: 30
    })
  })

  it("calls repo.getMessagesBySessionOrderedByTimestamp when exact=false", async () => {
    mockRepo.getMessagesBySessionOrderedByTimestamp.mockResolvedValue([
      {
        id: 30,
        role: "user",
        content: "msg",
        sessionId: SESSION_ID,
        parentId: undefined
      }
    ] as any)

    await chatSessionStore.getState().navigateToNode(SESSION_ID, 30, false)

    expect(
      mockRepo.getMessagesBySessionOrderedByTimestamp
    ).toHaveBeenCalledWith(SESSION_ID)
  })

  it("default (no exact arg) behaves like exact=false and fetches messages", async () => {
    mockRepo.getMessagesBySessionOrderedByTimestamp.mockResolvedValue([
      {
        id: 30,
        role: "user",
        content: "msg",
        sessionId: SESSION_ID,
        parentId: undefined
      }
    ] as any)

    await chatSessionStore.getState().navigateToNode(SESSION_ID, 30)

    expect(
      mockRepo.getMessagesBySessionOrderedByTimestamp
    ).toHaveBeenCalledWith(SESSION_ID)
  })
})

// ---------------------------------------------------------------------------
// loadSessions — already-hydrated guard
// ---------------------------------------------------------------------------

describe("loadSessions when hydrated=true", () => {
  it("is a no-op when hydrated=true", async () => {
    chatSessionStore.setState({
      sessions: [
        {
          id: SESSION_ID,
          title: "existing",
          createdAt: 1,
          updatedAt: 1,
          messages: []
        }
      ],
      currentSessionId: SESSION_ID,
      hasSession: true,
      hydrated: true
    })

    await chatSessionStore.getState().loadSessions()

    expect(mockRepo.getAllSessionsOrderedByRecency).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// togglePinSession / setSessionSystemPrompt
// ---------------------------------------------------------------------------

const seedSession = (extra: Record<string, unknown> = {}) => {
  chatSessionStore.setState({
    sessions: [
      {
        id: SESSION_ID,
        title: "T",
        createdAt: 1,
        updatedAt: 1,
        messages: [],
        ...extra
      }
    ],
    currentSessionId: SESSION_ID,
    hasSession: true,
    hydrated: true
  })
}

describe("togglePinSession", () => {
  it("flips and persists the pinned flag", async () => {
    mockRepo.updateSession.mockResolvedValue(undefined as any)
    seedSession({ pinned: false })

    await chatSessionStore.getState().togglePinSession(SESSION_ID)

    expect(mockRepo.updateSession).toHaveBeenCalledWith(SESSION_ID, {
      pinned: true
    })
    expect(chatSessionStore.getState().sessions[0].pinned).toBe(true)
  })
})

describe("setSessionSystemPrompt", () => {
  it("persists a trimmed prompt", async () => {
    mockRepo.updateSession.mockResolvedValue(undefined as any)
    seedSession()

    await chatSessionStore
      .getState()
      .setSessionSystemPrompt(SESSION_ID, "  Be concise  ")

    expect(mockRepo.updateSession).toHaveBeenCalledWith(SESSION_ID, {
      systemPrompt: "Be concise"
    })
    expect(chatSessionStore.getState().sessions[0].systemPrompt).toBe(
      "Be concise"
    )
  })

  it("clears the override when given only whitespace", async () => {
    mockRepo.updateSession.mockResolvedValue(undefined as any)
    seedSession({ systemPrompt: "old" })

    await chatSessionStore.getState().setSessionSystemPrompt(SESSION_ID, "   ")

    expect(mockRepo.updateSession).toHaveBeenCalledWith(SESSION_ID, {
      systemPrompt: undefined
    })
    expect(chatSessionStore.getState().sessions[0].systemPrompt).toBeUndefined()
  })
})

describe("setSessionTags", () => {
  it("normalizes, deduplicates, and persists tags", async () => {
    mockRepo.updateSession.mockResolvedValue(undefined as any)
    seedSession()

    await chatSessionStore
      .getState()
      .setSessionTags?.(SESSION_ID, [" work ", "research", "work", ""])

    expect(mockRepo.updateSession).toHaveBeenCalledWith(SESSION_ID, {
      tags: ["work", "research"]
    })
    expect(chatSessionStore.getState().sessions[0].tags).toEqual([
      "work",
      "research"
    ])
  })
})
