import { describe, it, expect, beforeEach, vi } from "vitest"
import { chatSessionStore } from "../chat-session-store"
import { db } from "@/lib/db"
import { deleteVectors } from "@/lib/embeddings/vector-store"

// Mock dependencies
vi.mock("@/lib/db", () => ({
  db: {
    sessions: {
      orderBy: vi.fn(),
      add: vi.fn(),
      delete: vi.fn(),
      update: vi.fn()
    },
    messages: {
      where: vi.fn(() => ({
        equals: vi.fn(() => ({
          sortBy: vi.fn(),
          delete: vi.fn()
        })),
        delete: vi.fn()
      })),
      bulkPut: vi.fn()
    },
    files: {
      where: vi.fn(() => ({
        equals: vi.fn(() => ({
          delete: vi.fn()
        }))
      })),
      delete: vi.fn()
    }
  }
}))

vi.mock("@/lib/embeddings/vector-store", () => ({
  deleteVectors: vi.fn()
}))

describe("chatSessionStore", () => {
  beforeEach(() => {
    // Reset store to initial state
    chatSessionStore.setState({
      sessions: [],
      currentSessionId: null,
      hasSession: false,
      hydrated: false,
      highlightedMessage: null
    })
    vi.clearAllMocks()
  })

  it("should initialize with empty state", () => {
    const state = chatSessionStore.getState()
    expect(state.sessions).toEqual([])
    expect(state.currentSessionId).toBeNull()
    expect(state.hasSession).toBe(false)
    expect(state.hydrated).toBe(false)
  })

  it("should set current session ID and trigger message load", async () => {
    const mockMessages = [{ role: "user", content: "Hi", timestamp: 1 }]
    // Mock the chain: db.messages.where().equals().sortBy()
    const sortByMock = vi.fn().mockResolvedValue(mockMessages)
    const equalsMock = vi.fn().mockReturnValue({ sortBy: sortByMock })
    const whereMock = vi.mocked(db.messages.where).mockReturnValue({ equals: equalsMock } as any)

    // Pre-populate a session so we can load it
    chatSessionStore.setState({
       sessions: [{ id: "session-1", title: "Test", createdAt: 0, updatedAt: 0, messages: [] }]
    })

    const { setCurrentSessionId } = chatSessionStore.getState()
    setCurrentSessionId("session-1")
    
    // allow async state update
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(db.messages.where).toHaveBeenCalledWith("sessionId")
    expect(equalsMock).toHaveBeenCalledWith("session-1")
    
    const state = chatSessionStore.getState()
    expect(state.currentSessionId).toBe("session-1")
    expect(state.sessions[0].messages).toEqual(mockMessages)
  })

  it("should set highlighted message", () => {
    const { setHighlightedMessage } = chatSessionStore.getState()
    const message = { role: "user" as const, content: "Test" }
    
    setHighlightedMessage(message)
    
    expect(chatSessionStore.getState().highlightedMessage).toBe(message)
  })

  it("should load sessions from database and load first session messages", async () => {
    const mockSessions = [
      { id: "1", title: "Chat 1", messages: [], createdAt: 100, updatedAt: 200 },
      { id: "2", title: "Chat 2", messages: [], createdAt: 50, updatedAt: 150 }
    ]

    vi.mocked(db.sessions.orderBy).mockReturnValue({
      reverse: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue(mockSessions)
      })
    } as any)

    // Mock message load for session 1
    const mockMessages = [{ role: "user", content: "Hi" }]
    const sortByMock = vi.fn().mockResolvedValue(mockMessages)
    const equalsMock = vi.fn().mockReturnValue({ sortBy: sortByMock })
    vi.mocked(db.messages.where).mockReturnValue({ equals: equalsMock } as any)

    const { loadSessions } = chatSessionStore.getState()
    await loadSessions()

    const state = chatSessionStore.getState()
    expect(state.sessions.length).toBe(2)
    // Should have updated metadata
    expect(state.sessions[0].id).toBe("1")
    // Should have loaded messages for first session
    expect(state.sessions[0].messages).toEqual(mockMessages)
    expect(state.currentSessionId).toBe("1")
  })

  it("should create new session with empty messages", async () => {
    vi.mocked(db.sessions.add).mockResolvedValue(1)
    
    const { createSession } = chatSessionStore.getState()
    await createSession()

    const state = chatSessionStore.getState()
    expect(state.sessions.length).toBe(1)
    expect(state.sessions[0].title).toBe("New Chat")
    expect(state.sessions[0].messages).toEqual([])
    expect(state.currentSessionId).toBe(state.sessions[0].id)
  })

  it("should delete session and its associated data", async () => {
    const sessions = [
      { id: "1", title: "Chat 1", messages: [], createdAt: 100, updatedAt: 100 },
      { id: "2", title: "Chat 2", messages: [], createdAt: 200, updatedAt: 200 }
    ]
    chatSessionStore.setState({ sessions, currentSessionId: "1", hasSession: true })

    vi.mocked(db.sessions.delete).mockResolvedValue()
    vi.mocked(deleteVectors).mockResolvedValue(5)
    
    // Mock cascading deletes
    const deleteMock = vi.fn().mockResolvedValue(undefined)
    const sortByMock = vi.fn().mockResolvedValue([])
    const equalsMock = vi.fn().mockReturnValue({ delete: deleteMock, sortBy: sortByMock })
    vi.mocked(db.messages.where).mockReturnValue({ equals: equalsMock } as any)
    vi.mocked(db.files.where).mockReturnValue({ equals: equalsMock } as any)

    const { deleteSession } = chatSessionStore.getState()
    await deleteSession("1")

    expect(db.sessions.delete).toHaveBeenCalledWith("1")
    expect(db.messages.where).toHaveBeenCalledWith("sessionId")
    expect(db.files.where).toHaveBeenCalledWith("sessionId")
    expect(equalsMock).toHaveBeenCalledWith("1") // for both
    expect(deleteVectors).toHaveBeenCalledWith({ sessionId: "1", type: "chat" })

    const state = chatSessionStore.getState()
    expect(state.sessions.length).toBe(1)
    expect(state.sessions[0].id).toBe("2")
  })

  it("should handle embedding deletion failure gracefully", async () => {
    const sessions = [
      { id: "1", title: "Chat 1", messages: [], createdAt: 100, updatedAt: 100 }
    ]
    chatSessionStore.setState({ sessions, currentSessionId: "1" })

    vi.mocked(db.sessions.delete).mockResolvedValue()
    vi.mocked(deleteVectors).mockRejectedValue(new Error("Embedding error"))
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    
    // Mock message/file deletion
    const deleteMock = vi.fn()
    const sortByMock = vi.fn().mockResolvedValue([])
    const equalsMock = vi.fn().mockReturnValue({ delete: deleteMock, sortBy: sortByMock })
    vi.mocked(db.messages.where).mockReturnValue({ equals: equalsMock } as any)
    vi.mocked(db.files.where).mockReturnValue({ equals: equalsMock } as any)

    const { deleteSession } = chatSessionStore.getState()
    await deleteSession("1")

    expect(consoleSpy).toHaveBeenCalled()
    expect(chatSessionStore.getState().sessions.length).toBe(0)
    
    consoleSpy.mockRestore()
  })

  it("should rename session title", async () => {
    const sessions = [
      { id: "1", title: "Old Title", messages: [], createdAt: 100, updatedAt: 100 }
    ]
    chatSessionStore.setState({ sessions })

    vi.mocked(db.sessions.update).mockResolvedValue(1)

    const { renameSessionTitle } = chatSessionStore.getState()
    await renameSessionTitle("1", "New Title")

    expect(db.sessions.update).toHaveBeenCalledWith("1", { title: "New Title" })
    expect(chatSessionStore.getState().sessions[0].title).toBe("New Title")
  })

  it("should update session metadata and save messages to new table", async () => {
    const sessions = [
      { id: "1", title: "Chat", messages: [], createdAt: 100, updatedAt: 100 }
    ]
    chatSessionStore.setState({ sessions })

    const newMessages = [{ role: "user" as const, content: "Hello", timestamp: 500 }]
    vi.mocked(db.sessions.update).mockResolvedValue(1)
    vi.mocked(db.messages.bulkPut).mockResolvedValue(1 as any)

    const { updateMessages } = chatSessionStore.getState()
    await updateMessages("1", newMessages)

    expect(db.sessions.update).toHaveBeenCalledWith("1", expect.objectContaining({ updatedAt: expect.any(Number) }))
    expect(db.messages.bulkPut).toHaveBeenCalledWith(
        expect.arrayContaining([
            expect.objectContaining({
                sessionId: "1",
                content: "Hello",
                timestamp: 500
            })
        ])
    )

    const state = chatSessionStore.getState()
    expect(state.sessions[0].messages).toEqual(newMessages)
  })
})
