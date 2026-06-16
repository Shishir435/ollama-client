import { act, renderHook } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { chatSessionStore } from "@/features/sessions/stores/chat-session-store"
import { bulkPutSessions } from "@/lib/repositories/chat-history"
import type { ChatSession } from "@/types"
import { useImportChat } from "../use-import-chat"

// Mock dependencies
vi.mock("@/lib/repositories/chat-history", () => ({
  bulkPutSessions: vi.fn()
}))

vi.mock("@/features/sessions/stores/chat-session-store", () => ({
  chatSessionStore: {
    setState: vi.fn()
  }
}))

const toastMock = vi.fn()
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastMock })
}))

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) =>
      vars ? `${key} ${JSON.stringify(vars)}` : key
  })
}))

// Build a single-file FileList from a JS value serialized to JSON.
const fileListOf = (value: unknown, name = "chat.json"): FileList => {
  const file = new File([JSON.stringify(value)], name, {
    type: "application/json"
  })
  return {
    0: file,
    length: 1,
    item: () => file,
    [Symbol.iterator]: function* () {
      yield file
    }
  } as unknown as FileList
}

// Pull the sessions array bulkPutSessions was last called with.
const lastImported = (): ChatSession[] =>
  vi.mocked(bulkPutSessions).mock.calls.at(-1)?.[0] ?? []

describe("useImportChat", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(bulkPutSessions).mockResolvedValue(undefined)
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
    expect(bulkPutSessions).not.toHaveBeenCalled()
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
    expect(bulkPutSessions).not.toHaveBeenCalled()
  })

  it("should import a valid single session and report success", async () => {
    const { result } = renderHook(() => useImportChat())
    const session = {
      id: "session-1",
      title: "Test Chat",
      messages: [{ role: "user", content: "Hello" }],
      createdAt: 1,
      updatedAt: 2
    }

    await act(async () => {
      await result.current.importChat(fileListOf(session))
    })

    const imported = lastImported()
    expect(imported).toHaveLength(1)
    expect(imported[0]).toMatchObject({ id: "session-1", title: "Test Chat" })
    expect(imported[0].messages).toHaveLength(1)
    expect(chatSessionStore.setState).toHaveBeenCalled()
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({ title: expect.stringContaining("success") })
    )
  })

  it("should import an array of sessions", async () => {
    const { result } = renderHook(() => useImportChat())
    const sessions = [
      {
        id: "session-1",
        title: "Chat 1",
        messages: [{ role: "user", content: "Hello" }],
        createdAt: 1,
        updatedAt: 2
      },
      {
        id: "session-2",
        title: "Chat 2",
        messages: [{ role: "assistant", content: "Hi" }],
        createdAt: 1,
        updatedAt: 2
      }
    ]

    await act(async () => {
      await result.current.importChat(fileListOf(sessions, "chats.json"))
    })

    expect(lastImported().map((s) => s.id)).toEqual(["session-1", "session-2"])
  })

  // ---- Salvage: the regression these changes fix ----------------------------
  // Each of these shapes previously failed the strict whole-session schema and
  // was silently dropped. They must now survive import.

  it("salvages a message with missing content (coerces to empty string)", async () => {
    const { result } = renderHook(() => useImportChat())
    const session = {
      id: "s",
      title: "t",
      createdAt: 1,
      updatedAt: 2,
      messages: [{ role: "assistant" }] // no content (e.g. a tool-call turn)
    }

    await act(async () => {
      await result.current.importChat(fileListOf(session))
    })

    const imported = lastImported()
    expect(imported).toHaveLength(1)
    expect(imported[0].messages?.[0]).toMatchObject({
      role: "assistant",
      content: ""
    })
  })

  it("salvages a session missing title and timestamps (fills defaults)", async () => {
    const { result } = renderHook(() => useImportChat())
    const session = { id: "s", messages: [{ role: "user", content: "hi" }] }

    await act(async () => {
      await result.current.importChat(fileListOf(session))
    })

    const imported = lastImported()
    expect(imported).toHaveLength(1)
    expect(typeof imported[0].title).toBe("string")
    expect(typeof imported[0].createdAt).toBe("number")
    expect(typeof imported[0].updatedAt).toBe("number")
  })

  it("drops an invalid image attachment but keeps the message and session", async () => {
    const { result } = renderHook(() => useImportChat())
    const session = {
      id: "s",
      title: "t",
      createdAt: 1,
      updatedAt: 2,
      messages: [
        {
          role: "user",
          content: "look",
          // base64 missing -> invalid ImageAttachment, must not nuke the session
          images: [
            { imageId: "i", fileName: "f", mimeType: "image/png", size: 1 }
          ]
        }
      ]
    }

    await act(async () => {
      await result.current.importChat(fileListOf(session))
    })

    const imported = lastImported()
    expect(imported).toHaveLength(1)
    const msg = imported[0].messages?.[0]
    expect(msg?.content).toBe("look")
    expect(msg?.images ?? []).toHaveLength(0)
  })

  it("drops only the unrescuable message inside an otherwise good session", async () => {
    const { result } = renderHook(() => useImportChat())
    const session = {
      id: "s",
      title: "t",
      createdAt: 1,
      updatedAt: 2,
      messages: [
        { role: "user", content: "keep me" },
        { content: "no role -> dropped" }
      ]
    }

    await act(async () => {
      await result.current.importChat(fileListOf(session))
    })

    const imported = lastImported()
    expect(imported).toHaveLength(1)
    expect(imported[0].messages).toHaveLength(1)
    expect(imported[0].messages?.[0].content).toBe("keep me")
  })

  it("skips a session with no rescuable messages and reports failure", async () => {
    const { result } = renderHook(() => useImportChat())
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {})

    await act(async () => {
      await result.current.importChat(fileListOf({ id: "s" }, "empty.json"))
    })

    expect(bulkPutSessions).not.toHaveBeenCalled()
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({ variant: "destructive" })
    )
    consoleSpy.mockRestore()
  })

  it("reports a partial import when some sessions are dropped", async () => {
    const { result } = renderHook(() => useImportChat())
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    const sessions = [
      {
        id: "ok",
        title: "t",
        createdAt: 1,
        updatedAt: 2,
        messages: [{ role: "user", content: "hi" }]
      },
      { id: "empty" } // no messages -> dropped
    ]

    await act(async () => {
      await result.current.importChat(fileListOf(sessions, "mixed.json"))
    })

    expect(lastImported().map((s) => s.id)).toEqual(["ok"])
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({ variant: "destructive" })
    )
    consoleSpy.mockRestore()
  })

  it("handles JSON parse errors without throwing", async () => {
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
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {})

    await act(async () => {
      await result.current.importChat(fileList)
    })

    expect(bulkPutSessions).not.toHaveBeenCalled()
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({ variant: "destructive" })
    )
    consoleSpy.mockRestore()
  })

  it("processes multiple files", async () => {
    const { result } = renderHook(() => useImportChat())
    const session1 = {
      id: "session-1",
      title: "Chat 1",
      messages: [{ role: "user", content: "a" }],
      createdAt: 1,
      updatedAt: 2
    }
    const session2 = {
      id: "session-2",
      title: "Chat 2",
      messages: [{ role: "user", content: "b" }],
      createdAt: 1,
      updatedAt: 2
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

    await act(async () => {
      await result.current.importChat(fileList)
    })

    expect(lastImported().map((s) => s.id)).toEqual(["session-1", "session-2"])
  })
})
