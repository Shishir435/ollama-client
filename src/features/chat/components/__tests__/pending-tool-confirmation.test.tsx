import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { PendingToolConfirmation } from "../pending-tool-confirmation"

const { sendMessage } = vi.hoisted(() => ({
  sendMessage: vi.fn(async () => ({ success: true }))
}))

vi.mock("@/lib/browser-api", () => ({
  runtime: { sendMessage }
}))

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { risk?: string }) => {
      if (key === "chat.tool_confirmation.risk_label") {
        return `Risk: ${options?.risk}`
      }
      if (key.startsWith("chat.tool_confirmation.risk.")) {
        return key.split(".").at(-1)
      }
      return key.split(".").at(-1) ?? key
    }
  })
}))

describe("pending tool confirmation", () => {
  it("announces risk and accepts keyboard approval only on focused surface", async () => {
    render(
      <PendingToolConfirmation
        messages={[
          {
            id: 1,
            role: "assistant",
            content: "",
            metrics: {
              toolRuns: [
                {
                  toolId: "click",
                  callId: "call-1",
                  label: "click",
                  risk: "critical",
                  status: "awaiting-confirmation",
                  startedAt: 1,
                  approvalPreview: 'Click "Delete" on example.com'
                }
              ]
            }
          }
        ]}
      />
    )

    const surface = screen.getByRole("alert")
    expect(screen.getByText("Risk: critical")).toBeInTheDocument()
    expect(surface).toHaveFocus()
    fireEvent.keyDown(surface, { key: "y" })

    await waitFor(() =>
      expect(sendMessage).toHaveBeenCalledWith({
        type: "confirm-tool",
        payload: {
          callId: "call-1",
          approved: true,
          scope: "once"
        }
      })
    )
  })

  it("hides stale approval controls while an agent is paused", () => {
    render(
      <PendingToolConfirmation
        agentPaused
        messages={[
          {
            id: 1,
            role: "assistant",
            content: "",
            metrics: {
              toolRuns: [
                {
                  toolId: "click",
                  callId: "call-1",
                  label: "click",
                  risk: "critical",
                  status: "awaiting-confirmation",
                  startedAt: 1
                }
              ]
            }
          }
        ]}
      />
    )

    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  })
})
