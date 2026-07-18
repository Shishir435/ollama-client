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
})
