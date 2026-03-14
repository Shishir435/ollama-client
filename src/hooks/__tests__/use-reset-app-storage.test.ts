import { renderHook } from "@testing-library/react"
import { vi, describe, it, expect, beforeEach } from "vitest"
import { useResetAppStorage } from "../use-reset-app-storage"
import { db } from "@/lib/db"
import { feedbackService } from "@/lib/embeddings/feedback-service"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"

vi.mock("@/lib/db", () => ({
  db: {
    delete: vi.fn().mockResolvedValue(undefined)
  }
}))

vi.mock("@/lib/embeddings/feedback-service", () => ({
  feedbackService: {
    clearAllFeedback: vi.fn().mockResolvedValue(undefined)
  }
}))

describe("useResetAppStorage", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("should reset all data when key is 'all'", async () => {
    const { result } = renderHook(() => useResetAppStorage())
    const reset = result.current

    await reset("all")

    expect(db.delete).toHaveBeenCalled()
    expect(feedbackService.clearAllFeedback).toHaveBeenCalled()
    expect(plasmoGlobalStorage.clear).toHaveBeenCalled()
  })

  it("should reset only chat sessions when key is 'CHAT_SESSIONS'", async () => {
    const { result } = renderHook(() => useResetAppStorage())
    const reset = result.current

    await reset("CHAT_SESSIONS")

    expect(db.delete).toHaveBeenCalled()
    expect(feedbackService.clearAllFeedback).not.toHaveBeenCalled()
    expect(plasmoGlobalStorage.remove).not.toHaveBeenCalled()
  })

  it("should reset only feedback when key is 'FEEDBACK'", async () => {
    const { result } = renderHook(() => useResetAppStorage())
    const reset = result.current

    await reset("FEEDBACK")

    expect(feedbackService.clearAllFeedback).toHaveBeenCalled()
    expect(db.delete).not.toHaveBeenCalled()
    expect(plasmoGlobalStorage.remove).not.toHaveBeenCalled()
  })

  it("should reset specific module keys when key is a module name", async () => {
    const { result } = renderHook(() => useResetAppStorage())
    const reset = result.current

    // THEME module usually has keys
    await reset("THEME")

    expect(plasmoGlobalStorage.remove).toHaveBeenCalled()
    expect(db.delete).not.toHaveBeenCalled()
    expect(feedbackService.clearAllFeedback).not.toHaveBeenCalled()
  })
})
