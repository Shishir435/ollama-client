import { renderHook } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { useChatSessionLifecycle } from "../use-chat-session-lifecycle"

describe("useChatSessionLifecycle", () => {
  it("replaces a stale current-session id before sending", async () => {
    const createSession = vi.fn().mockResolvedValue("fresh-session")
    const setCurrentSessionId = vi.fn()
    const { result } = renderHook(() =>
      useChatSessionLifecycle({
        currentSessionId: "missing-session",
        sessions: [],
        createSession,
        setCurrentSessionId,
        renameSessionTitle: vi.fn()
      })
    )

    await expect(result.current.ensureSessionId()).resolves.toBe(
      "fresh-session"
    )
    expect(createSession).toHaveBeenCalledOnce()
    expect(setCurrentSessionId).toHaveBeenCalledWith("fresh-session")
  })

  const sessionWith = (title: string, titleSource?: "manual") => ({
    id: "s1",
    title,
    createdAt: 1,
    updatedAt: 1,
    ...(titleSource ? { titleSource } : {})
  })

  it("auto-titles a chat still called New Chat from its first line", async () => {
    const renameSessionTitle = vi.fn()
    const { result } = renderHook(() =>
      useChatSessionLifecycle({
        currentSessionId: "s1",
        sessions: [sessionWith("New Chat")],
        createSession: vi.fn(),
        setCurrentSessionId: vi.fn(),
        renameSessionTitle
      })
    )

    await result.current.autoRenameSession("s1", "  first line\nsecond")
    expect(renameSessionTitle).toHaveBeenCalledWith("s1", "first line")
  })

  it("leaves a chat the user named alone, even one named New Chat", async () => {
    const renameSessionTitle = vi.fn()
    const { result } = renderHook(() =>
      useChatSessionLifecycle({
        currentSessionId: "s1",
        sessions: [sessionWith("New Chat", "manual")],
        createSession: vi.fn(),
        setCurrentSessionId: vi.fn(),
        renameSessionTitle
      })
    )

    await result.current.autoRenameSession("s1", "first line")
    expect(renameSessionTitle).not.toHaveBeenCalled()
  })
})
