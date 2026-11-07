import { renderHook } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { useSetting } from "@/hooks/use-setting"
import { requestMessageIndexing } from "@/protocol/embedding-client"
import { useAutoEmbedMessages } from "../use-auto-embed-messages"
vi.mock("@/hooks/use-setting", () => ({ useSetting: vi.fn() }))
vi.mock("@/protocol/embedding-client", () => ({
  requestMessageIndexing: vi.fn(async () => {})
}))
describe("background message indexing intent", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useSetting).mockReturnValue([true, vi.fn(), { isLoading: false }])
  })
  it("queues canonical ids without forwarding message content", async () => {
    const { result } = renderHook(() => useAutoEmbedMessages())
    await result.current.embedMessages(
      [
        { id: 1, role: "user", content: "PRIVATE-CANARY" },
        { id: 2, role: "assistant", content: "answer", done: true }
      ],
      "session"
    )
    expect(requestMessageIndexing).toHaveBeenCalledWith([1, 2])
    expect(
      JSON.stringify(vi.mocked(requestMessageIndexing).mock.calls)
    ).not.toContain("PRIVATE-CANARY")
  })
  it("does not queue partial replies or permission notices", async () => {
    const { result } = renderHook(() => useAutoEmbedMessages())
    await result.current.embedMessages(
      [
        { id: 1, role: "assistant", content: "partial", done: false },
        { id: 2, role: "system", content: "policy" }
      ],
      "session"
    )
    expect(requestMessageIndexing).not.toHaveBeenCalled()
  })
  it("honors memory opt-out", async () => {
    vi.mocked(useSetting).mockReturnValue([
      false,
      vi.fn(),
      { isLoading: false }
    ])
    const { result } = renderHook(() => useAutoEmbedMessages())
    await result.current.embedMessage(
      { id: 1, role: "user", content: "question" },
      "session"
    )
    expect(requestMessageIndexing).not.toHaveBeenCalled()
  })
})
