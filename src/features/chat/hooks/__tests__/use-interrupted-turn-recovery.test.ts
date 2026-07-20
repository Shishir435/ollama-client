import { renderHook, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { useInterruptedTurnRecovery } from "../use-interrupted-turn-recovery"

const finalizeInterruptedMessages = vi.fn()
const loadSessionMessages = vi.fn()
const isStreamingActiveElsewhere = vi.fn()
let storeState: {
  currentSessionId: string | null
  loadSessionMessages: typeof loadSessionMessages
}

vi.mock("@/lib/repositories/chat-history", () => ({
  finalizeInterruptedMessages: () => finalizeInterruptedMessages()
}))

vi.mock("@/features/chat/lib/streaming-heartbeat", () => ({
  isStreamingActiveElsewhere: () => isStreamingActiveElsewhere()
}))

vi.mock("@/features/sessions/stores/chat-session-store", () => ({
  chatSessionStore: { getState: () => storeState }
}))

describe("useInterruptedTurnRecovery", () => {
  beforeEach(() => {
    finalizeInterruptedMessages.mockReset()
    loadSessionMessages.mockReset()
    isStreamingActiveElsewhere.mockReset()
    isStreamingActiveElsewhere.mockResolvedValue(false)
    storeState = { currentSessionId: "s1", loadSessionMessages }
  })

  it("reloads the open session when orphans were finalized", async () => {
    finalizeInterruptedMessages.mockResolvedValue(2)
    renderHook(() => useInterruptedTurnRecovery())
    await waitFor(() => expect(loadSessionMessages).toHaveBeenCalledWith("s1"))
  })

  it("skips the reload when nothing was finalized", async () => {
    finalizeInterruptedMessages.mockResolvedValue(0)
    renderHook(() => useInterruptedTurnRecovery())
    await waitFor(() =>
      expect(finalizeInterruptedMessages).toHaveBeenCalledTimes(1)
    )
    expect(loadSessionMessages).not.toHaveBeenCalled()
  })

  it("does not reload when no session is open", async () => {
    finalizeInterruptedMessages.mockResolvedValue(3)
    storeState = { currentSessionId: null, loadSessionMessages }
    renderHook(() => useInterruptedTurnRecovery())
    await waitFor(() =>
      expect(finalizeInterruptedMessages).toHaveBeenCalledTimes(1)
    )
    expect(loadSessionMessages).not.toHaveBeenCalled()
  })

  it("defers the sweep while a stream is active in another panel", async () => {
    isStreamingActiveElsewhere.mockResolvedValue(true)
    finalizeInterruptedMessages.mockResolvedValue(1)
    renderHook(() => useInterruptedTurnRecovery())
    await waitFor(() =>
      expect(isStreamingActiveElsewhere).toHaveBeenCalledTimes(1)
    )
    expect(finalizeInterruptedMessages).not.toHaveBeenCalled()
    expect(loadSessionMessages).not.toHaveBeenCalled()
  })
})
