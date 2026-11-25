import { beforeEach, describe, expect, it, vi } from "vitest"
import { sendRuntimeMessage } from "@/lib/retained-runtime-messages"
import {
  addSelectionToChatContext,
  openSelectionResultInChat
} from "../content-result-actions"
import type { SelectionCapture } from "../dom"

vi.mock("@/lib/retained-runtime-messages", () => ({
  sendRuntimeMessage: vi.fn()
}))

const capture = { text: "Original selection" } as SelectionCapture

describe("selection new-chat handoff", () => {
  beforeEach(() => {
    vi.mocked(sendRuntimeMessage).mockReset()
  })

  it("requests a new chat for the original selection and result", async () => {
    vi.mocked(sendRuntimeMessage).mockResolvedValue({ success: true })
    expect(await openSelectionResultInChat("Result", capture)).toBe(true)
    expect(sendRuntimeMessage).toHaveBeenCalledWith("add-selection-to-chat", {
      payload: {
        text: "Original selection\n\n---\n\nResult",
        destination: "new-chat"
      }
    })
  })

  it("also opens a fresh chat for the toolbar's selection-only action", async () => {
    vi.mocked(sendRuntimeMessage).mockResolvedValue({ success: true })
    expect(await openSelectionResultInChat("", capture)).toBe(true)
    expect(sendRuntimeMessage).toHaveBeenCalledWith("add-selection-to-chat", {
      payload: { text: "Original selection", destination: "new-chat" }
    })
  })

  it("reports a failed or rejected handoff without clearing the selection", async () => {
    const clear = vi.spyOn(window.getSelection()!, "removeAllRanges")
    vi.mocked(sendRuntimeMessage).mockResolvedValue({ success: false })
    expect(await openSelectionResultInChat("Result", capture)).toBe(false)
    vi.mocked(sendRuntimeMessage).mockRejectedValue(new Error("Disconnected"))
    expect(await openSelectionResultInChat("Result", capture)).toBe(false)
    expect(clear).not.toHaveBeenCalled()
    clear.mockRestore()
  })

  it("does not open an empty chat", async () => {
    expect(await openSelectionResultInChat(" ", null)).toBe(false)
    expect(sendRuntimeMessage).not.toHaveBeenCalled()
  })
})

describe("selection as chat context", () => {
  beforeEach(() => {
    vi.mocked(sendRuntimeMessage).mockReset()
  })

  it("asks for the selection to be added as context, not for a new chat", async () => {
    vi.mocked(sendRuntimeMessage).mockResolvedValue({ success: true })

    expect(await addSelectionToChatContext(capture)).toBe(true)
    expect(sendRuntimeMessage).toHaveBeenCalledWith("add-selection-to-chat", {
      payload: { text: "Original selection", destination: "context" }
    })
  })

  it("leaves the page's selection in place", async () => {
    const clear = vi.spyOn(window.getSelection()!, "removeAllRanges")
    vi.mocked(sendRuntimeMessage).mockResolvedValue({ success: true })

    await addSelectionToChatContext(capture)

    expect(clear).not.toHaveBeenCalled()
    clear.mockRestore()
  })

  it("cuts a very long selection to what the background accepts", async () => {
    vi.mocked(sendRuntimeMessage).mockResolvedValue({ success: true })

    await addSelectionToChatContext({
      text: "x".repeat(20_000)
    } as SelectionCapture)

    const payload = vi.mocked(sendRuntimeMessage).mock.calls[0][1] as {
      payload: { text: string }
    }
    expect(payload.payload.text).toHaveLength(8000)
  })

  it("reports a refusal or a disconnected background as a failure", async () => {
    vi.mocked(sendRuntimeMessage).mockResolvedValue({ success: false })
    expect(await addSelectionToChatContext(capture)).toBe(false)
    vi.mocked(sendRuntimeMessage).mockRejectedValue(new Error("Disconnected"))
    expect(await addSelectionToChatContext(capture)).toBe(false)
  })

  it("sends nothing for an empty selection", async () => {
    expect(await addSelectionToChatContext(null)).toBe(false)
    expect(
      await addSelectionToChatContext({ text: "  " } as SelectionCapture)
    ).toBe(false)
    expect(sendRuntimeMessage).not.toHaveBeenCalled()
  })
})
