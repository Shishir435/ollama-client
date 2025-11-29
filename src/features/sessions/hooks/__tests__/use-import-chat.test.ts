import { describe, it, expect, beforeEach, vi } from "vitest"
import { renderHook, act } from "@testing-library/react"
import { useImportChat } from "../use-import-chat"
import { db } from "@/lib/db"
import { chatSessionStore } from "@/features/sessions/stores/chat-session-store"

// Mock dependencies
vi.mock("@/lib/db", () => ({
  db: {
    sessions: {
      bulkPut: vi.fn()
    }
  }
}))

vi.mock("@/features/sessions/stores/chat-session-store", () => ({
  chatSessionStore: {
    setState: vi.fn()
  }
}))

describe("useImportChat", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("should initialize with importChat function", () => {
    const { result } = renderHook(() => useImportChat())
    expect(result.current.importChat).toBeDefined()
  })

  it("should handle null/undefined files", async () => {
    const { result } = renderHook(() => useImportChat())

    await act(async () => {
      await result.current.importChat(null)
    })

    expect(db.sessions.bulkPut).not.toHaveBeenCalled()
  })

  it("should skip non-JSON files", async () => {
    const { result } = renderHook(() => useImportChat())
    const mockFile = new File(["content"], "test.txt", { type: "text/plain" })
    const fileList = {
      0: mockFile,
      length: 1,
      item: () => mockFile,
      [Symbol.iterator]: function* () {
        yield mockFile
      }
    } as unknown as FileList

    await act(async () => {
      await result.current.importChat(fileList)
    })

    expect(db.sessions.bulkPut).not.toHaveBeenCalled()
  })

  it("should import valid single session", async () => {
    const { result } = renderHook(() => useImportChat())
    const session = {
      id: "session-1",
      title: "Test Chat",
      messages: [{ role: "user", content: "Hello" }],
      createdAt: Date.now(),
      updatedAt: Date.now()
    }

    const mockFile = new File([JSON.stringify(session)], "chat.json", {
      type: "application/json"
    })
    const fileList = {
      0: mockFile,
      length: 1,
      item: () => mockFile,
      [Symbol.iterator]: function* () {
        yield mockFile
      }
    } as unknown as FileList

    vi.mocked(db.sessions.bulkPut).mockResolvedValue(1)

    await act(async () => {
      await result.current.importChat(fileList)
    })

    expect(db.sessions.bulkPut).toHaveBeenCalledWith([session])
    expect(chatSessionStore.setState).toHaveBeenCalled()
  })

  it("should import array of sessions", async () => {
    const { result } = renderHook(() => useImportChat())
    const sessions = [
      {
        id: "session-1",
        title: "Chat 1",
        messages: [{ role: "user", content: "Hello" }],
        createdAt: Date.now(),
        updatedAt: Date.now()
      },
      {
        id: "session-2",
        title: "Chat 2",
        messages: [{ role: "assistant", content: "Hi" }],
        createdAt: Date.now(),
        updatedAt: Date.now()
      }
    ]

    const mockFile = new File([JSON.stringify(sessions)], "chats.json", {
      type: "application/json"
    })
    const fileList = {
      0: mockFile,
      length: 1,
      item: () => mockFile,
      [Symbol.iterator]: function* () {
        yield mockFile
      }
    } as unknown as FileList

    vi.mocked(db.sessions.bulkPut).mockResolvedValue(2)

    await act(async () => {
      await result.current.importChat(fileList)
    })

    expect(db.sessions.bulkPut).toHaveBeenCalledWith(sessions)
  })

  it("should skip invalid sessions", async () => {
    const { result } = renderHook(() => useImportChat())
    const invalidSession = {
      id: "session-1",
      // Missing title, createdAt, updatedAt, messages
    }

    const mockFile = new File([JSON.stringify(invalidSession)], "invalid.json", {
      type: "application/json"
    })
    const fileList = {
      0: mockFile,
      length: 1,
      item: () => mockFile,
      [Symbol.iterator]: function* () {
        yield mockFile
      }
    } as unknown as FileList

    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {})

    await act(async () => {
      await result.current.importChat(fileList)
    })

    expect(consoleSpy).toHaveBeenCalled()
    expect(db.sessions.bulkPut).not.toHaveBeenCalled()

    consoleSpy.mockRestore()
  })

  it("should handle JSON parse errors", async () => {
    const { result } = renderHook(() => useImportChat())
    const mockFile = new File(["invalid json{"], "error.json", {
      type: "application/json"
    })
    const fileList = {
      0: mockFile,
      length: 1,
      item: () => mockFile,
      [Symbol.iterator]: function* () {
        yield mockFile
      }
    } as unknown as FileList

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {})

    await act(async () => {
      await result.current.importChat(fileList)
    })

    expect(consoleSpy).toHaveBeenCalled()
    expect(db.sessions.bulkPut).not.toHaveBeenCalled()

    consoleSpy.mockRestore()
  })

  it("should validate message structure", async () => {
    const { result } = renderHook(() => useImportChat())
    const sessionWithInvalidMessage = {
      id: "session-1",
      title: "Test",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: [{ role: "user" }] // Missing content
    }

    const mockFile = new File(
      [JSON.stringify(sessionWithInvalidMessage)],
      "invalid-msg.json",
      { type: "application/json" }
    )
    const fileList = {
      0: mockFile,
      length: 1,
      item: () => mockFile,
      [Symbol.iterator]: function* () {
        yield mockFile
      }
    } as unknown as FileList

    await act(async () => {
      await result.current.importChat(fileList)
    })

    expect(db.sessions.bulkPut).not.toHaveBeenCalled()
  })

  it("should process multiple files", async () => {
    const { result } = renderHook(() => useImportChat())
    const session1 = {
      id: "session-1",
      title: "Chat 1",
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now()
    }
    const session2 = {
      id: "session-2",
      title: "Chat 2",
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now()
    }

    const file1 = new File([JSON.stringify(session1)], "chat1.json", {
      type: "application/json"
    })
    const file2 = new File([JSON.stringify(session2)], "chat2.json", {
      type: "application/json"
    })
    const fileList = {
      0: file1,
      1: file2,
      length: 2,
      item: (index: number) => [file1, file2][index],
      [Symbol.iterator]: function* () {
        yield file1
        yield file2
      }
    } as unknown as FileList

    vi.mocked(db.sessions.bulkPut).mockResolvedValue(2)

    await act(async () => {
      await result.current.importChat(fileList)
    })

    expect(db.sessions.bulkPut).toHaveBeenCalledWith([session1, session2])
  })
})
