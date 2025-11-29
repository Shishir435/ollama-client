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

  it("should set current session ID", () => {
    const { setCurrentSessionId } = chatSessionStore.getState()
    setCurrentSessionId("session-1")
    
    const state = chatSessionStore.getState()
    expect(state.currentSessionId).toBe("session-1")
    expect(state.hasSession).toBe(true)
  })

  it("should set highlighted message", () => {
    const { setHighlightedMessage } = chatSessionStore.getState()
    const message = { role: "user" as const, content: "Test" }
    
    setHighlightedMessage(message)
    
    expect(chatSessionStore.getState().highlightedMessage).toBe(message)
  })

  it("should load sessions from database", async () => {
    const mockSessions = [
      { id: "1", title: "Chat 1", messages: [], createdAt: 100, updatedAt: 200 },
      { id: "2", title: "Chat 2", messages: [], createdAt: 50, updatedAt: 150 }
    ]

    vi.mocked(db.sessions.orderBy).mockReturnValue({
      reverse: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue(mockSessions)
      })
    } as any)

    const { loadSessions } = chatSessionStore.getState()
    await loadSessions()

    const state = chatSessionStore.getState()
    expect(state.sessions).toEqual(mockSessions)
    expect(state.currentSessionId).toBe("1")
    expect(state.hasSession).toBe(true)
    expect(state.hydrated).toBe(true)
  })

  it("should not reload sessions if already hydrated", async () => {
    chatSessionStore.setState({ hydrated: true })
    
    const { loadSessions } = chatSessionStore.getState()
    await loadSessions()

    expect(db.sessions.orderBy).not.toHaveBeenCalled()
  })

  it("should create new session", async () => {
    vi.mocked(db.sessions.add).mockResolvedValue(1)
    
    const { createSession } = chatSessionStore.getState()
    await createSession()

    const state = chatSessionStore.getState()
    expect(state.sessions.length).toBe(1)
    expect(state.sessions[0].title).toBe("New Chat")
    expect(state.sessions[0].messages).toEqual([])
    expect(state.currentSessionId).toBe(state.sessions[0].id)
    expect(state.hasSession).toBe(true)
  })

  it("should delete session and its embeddings", async () => {
    const sessions = [
      { id: "1", title: "Chat 1", messages: [], createdAt: 100, updatedAt: 100 },
      { id: "2", title: "Chat 2", messages: [], createdAt: 200, updatedAt: 200 }
    ]
    chatSessionStore.setState({ sessions, currentSessionId: "1", hasSession: true })

    vi.mocked(db.sessions.delete).mockResolvedValue()
    vi.mocked(deleteVectors).mockResolvedValue(5)

    const { deleteSession } = chatSessionStore.getState()
    await deleteSession("1")

    expect(db.sessions.delete).toHaveBeenCalledWith("1")
    expect(deleteVectors).toHaveBeenCalledWith({ sessionId: "1", type: "chat" })

    const state = chatSessionStore.getState()
    expect(state.sessions.length).toBe(1)
    expect(state.sessions[0].id).toBe("2")
    expect(state.currentSessionId).toBe("2")
  })

  it("should handle embedding deletion failure gracefully", async () => {
    const sessions = [
      { id: "1", title: "Chat 1", messages: [], createdAt: 100, updatedAt: 100 }
    ]
    chatSessionStore.setState({ sessions, currentSessionId: "1" })

    vi.mocked(db.sessions.delete).mockResolvedValue()
    vi.mocked(deleteVectors).mockRejectedValue(new Error("Embedding error"))
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {})

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

  it("should update messages", async () => {
    const sessions = [
      { id: "1", title: "Chat", messages: [], createdAt: 100, updatedAt: 100 }
    ]
    chatSessionStore.setState({ sessions })

    const newMessages = [{ role: "user" as const, content: "Hello" }]
    vi.mocked(db.sessions.update).mockResolvedValue(1)

    const { updateMessages } = chatSessionStore.getState()
    await updateMessages("1", newMessages)

    const state = chatSessionStore.getState()
    expect(state.sessions[0].messages).toEqual(newMessages)
    expect(state.sessions[0].updatedAt).toBeGreaterThan(100)
  })
})
