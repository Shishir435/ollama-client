import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { loadStreamStore } from "@/features/chat/stores/load-stream-store"
import { SendOrStopButton } from "../send-or-stop-button"

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { key?: string }) =>
      options?.key ? `${key}:${options.key}` : key
  })
}))

describe("SendOrStopButton", () => {
  it("shows a labelled Stop button with the Escape hint while generating", () => {
    loadStreamStore.setState({ isStreaming: true, isLoading: false })
    const stop = vi.fn()
    render(<SendOrStopButton onSend={vi.fn()} stopGeneration={stop} />)
    expect(screen.getByText("chat.send.stop")).toBeInTheDocument()
    expect(screen.getByText("chat.send.stop_hint:Esc")).toBeInTheDocument()
    fireEvent.click(
      screen.getByRole("button", { name: "chat.send.stop_generation" })
    )
    expect(stop).toHaveBeenCalledOnce()
    loadStreamStore.setState({ isStreaming: false, isLoading: false })
  })

  it("disables Send while tab text is still being read", () => {
    loadStreamStore.setState({ isStreaming: false, isLoading: false })
    render(
      <SendOrStopButton
        onSend={vi.fn()}
        stopGeneration={vi.fn()}
        disabledSend
        hasContent
        sendLabel="reading"
      />
    )
    expect(screen.getByRole("button", { name: "reading" })).toBeDisabled()
  })
})
