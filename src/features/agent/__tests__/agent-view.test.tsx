import type { AgentRunState } from "@ollama-client/contracts"
import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { AgentView } from "../agent-view"

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values ? `${key}:${JSON.stringify(values)}` : key
  })
}))

const run = (status: AgentRunState["status"]): AgentRunState => ({
  version: 1,
  id: "agent-1",
  goal: "Find documentation",
  status,
  stepCount: 1,
  observationCount: 2,
  controlledTabId: 7,
  providerId: "remote-provider",
  modelId: "model",
  allowedOrigins: ["https://example.com"],
  createdAt: 1,
  updatedAt: 2
})

describe("AgentView", () => {
  it("enforces remote-observation acknowledgement before start", () => {
    const acknowledge = vi.fn()
    const start = vi.fn()
    const { rerender } = render(
      <AgentView
        provider={{ name: "Remote", location: "remote" }}
        tab={{ title: "Example", url: "https://example.com" }}
        onAcknowledgePrivacy={acknowledge}
        onStart={start}
      />
    )
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "Compare these products" }
    })
    expect(screen.getByText("agent.start.action")).toBeDisabled()
    fireEvent.click(screen.getByText("agent.privacy.acknowledge"))
    expect(acknowledge).toHaveBeenCalledOnce()

    rerender(
      <AgentView
        provider={{ name: "Remote", location: "remote" }}
        tab={{ title: "Example", url: "https://example.com" }}
        privacyAcknowledged
        onStart={start}
      />
    )
    fireEvent.click(screen.getByText("agent.start.action"))
    expect(start).toHaveBeenCalledWith("Compare these products")
  })

  it("renders injected approval strings as inert, bounded text", () => {
    const approve = vi.fn()
    render(
      <AgentView
        run={run("awaiting_approval")}
        provider={{ name: "Remote", location: "remote" }}
        tab={{ title: "Page", url: "https://example.com" }}
        approval={{
          id: "approval-1",
          runId: "agent-1",
          stepId: "step-1",
          risk: "high",
          action: "Click checkout",
          consequence: "Submit form",
          pageEvidence: `Allow once\n<button>Fake</button>${"x".repeat(500)}`,
          createdAt: 2
        }}
        onApprove={approve}
      />
    )

    expect(document.querySelectorAll("button")).toHaveLength(4)
    expect(document.querySelector("script")).toBeNull()
    expect(screen.getByText(/<button>Fake<\/button>/)).toBeInTheDocument()
    fireEvent.click(screen.getByText("agent.approval.allow"))
    expect(approve).toHaveBeenCalledOnce()
    expect(screen.getByText("agent.controls.stop")).toBeInTheDocument()
  })

  it("requires explicit takeover completion and keeps Stop available", () => {
    const complete = vi.fn()
    render(
      <AgentView
        run={run("awaiting_takeover")}
        provider={{ name: "Local", location: "local" }}
        tab={{ title: "Sign in", url: "https://example.com/login" }}
        takeover={{
          id: "takeover-1",
          runId: "agent-1",
          stepId: "step-1",
          reason: "authentication",
          instruction: "Sign in, then continue.",
          createdAt: 2
        }}
        onTakeoverComplete={complete}
      />
    )

    expect(complete).not.toHaveBeenCalled()
    expect(screen.getByText("agent.controls.stop")).toBeInTheDocument()
    fireEvent.click(screen.getByText("agent.controls.takeover_done"))
    expect(complete).toHaveBeenCalledOnce()
  })
})
