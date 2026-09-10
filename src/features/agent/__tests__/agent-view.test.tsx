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
    const onGoalChange = vi.fn()
    const textOnly = {
      name: "Remote",
      model: "qwen3",
      location: "remote" as const,
      screenshots: false
    }
    const { rerender } = render(
      <AgentView
        provider={textOnly}
        tab={{ title: "Example", url: "https://example.com" }}
        goal="Compare these products"
        onGoalChange={onGoalChange}
        onAcknowledgePrivacy={acknowledge}
        onStart={start}
      />
    )
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "Compare these products now" }
    })
    expect(onGoalChange).toHaveBeenCalledWith("Compare these products now")
    expect(screen.getByText("agent.start.action")).toBeDisabled()
    expect(screen.getByText("agent.privacy.remote_notice")).toBeInTheDocument()
    fireEvent.click(screen.getByText("agent.privacy.acknowledge"))
    expect(acknowledge).toHaveBeenCalledWith("observations")

    rerender(
      <AgentView
        provider={textOnly}
        tab={{ title: "Example", url: "https://example.com" }}
        goal="Compare these products"
        privacyAcknowledged
        onStart={start}
      />
    )
    fireEvent.click(screen.getByText("agent.start.action"))
    expect(start).toHaveBeenCalledWith("Compare these products")
  })

  it("asks separately about screenshots when they may travel, unknown included", () => {
    const acknowledge = vi.fn()
    const start = vi.fn()
    const remote = {
      name: "Remote",
      model: "llava",
      location: "remote" as const
    }
    const { rerender } = render(
      <AgentView
        provider={remote}
        tab={{ title: "Example", url: "https://example.com" }}
        goal="Find the red square"
        privacyAcknowledged
        onAcknowledgePrivacy={acknowledge}
        onStart={start}
      />
    )
    /* Observations were acknowledged once; that does not cover pictures. */
    expect(screen.getByText("agent.start.action")).toBeDisabled()
    expect(
      screen.getByText("agent.privacy.remote_notice_screenshots")
    ).toBeInTheDocument()
    fireEvent.click(screen.getByText("agent.privacy.acknowledge"))
    expect(acknowledge).toHaveBeenCalledWith("screenshots")

    rerender(
      <AgentView
        provider={{ ...remote, screenshots: true }}
        tab={{ title: "Example", url: "https://example.com" }}
        goal="Find the red square"
        privacyAcknowledged
        screenshotsAcknowledged
        onStart={start}
      />
    )
    fireEvent.click(screen.getByText("agent.start.action"))
    expect(start).toHaveBeenCalledWith("Find the red square")
  })

  it("keeps a failed run on screen with the reason it recorded", () => {
    render(
      <AgentView
        run={{
          ...run("failed"),
          error: {
            code: "invalid_decision",
            message: "The model returned too many invalid decisions.",
            retryable: false
          }
        }}
        provider={{ name: "Local", model: "qwen3", location: "local" }}
        tab={{ title: "Page", url: "https://example.com" }}
        goal="Click the save button"
      />
    )

    expect(
      screen.getByText("The model returned too many invalid decisions.")
    ).toBeInTheDocument()
    // A settled run is done being supervised, and the next one starts here.
    expect(screen.getByText("agent.start.action")).toBeInTheDocument()
    expect(screen.queryByText("agent.controls.stop")).not.toBeInTheDocument()
  })

  it("shows the model's result when a run completes", () => {
    render(
      <AgentView
        run={{ ...run("completed"), result: "Pricing page found." }}
        provider={{ name: "Local", model: "qwen3", location: "local" }}
        tab={{ title: "Pricing", url: "https://example.com/pricing" }}
      />
    )

    expect(screen.getByText("Pricing page found.")).toBeInTheDocument()
  })

  it("renders injected approval strings as inert, bounded text", () => {
    const approve = vi.fn()
    render(
      <AgentView
        run={run("awaiting_approval")}
        provider={{ name: "Remote", model: "qwen3", location: "remote" }}
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
        provider={{ name: "Local", model: "qwen3", location: "local" }}
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

  it("answers an open question instead of offering to resume past it", () => {
    const answer = vi.fn()
    render(
      <AgentView
        onAnswer={answer}
        privacyAcknowledged
        run={{
          ...run("paused"),
          pauseReason: "question",
          question: {
            id: "agent-1:q2",
            text: "Which of the two accounts?",
            askedAt: 1
          }
        }}
      />
    )

    // Resuming would take the run to another observation without the
    // information it asked for.
    expect(
      screen.getByText("agent.controls.resume").closest("button")
    ).toBeDisabled()

    fireEvent.change(screen.getByLabelText("agent.question.inputLabel"), {
      target: { value: "The second one." }
    })
    fireEvent.click(screen.getByText("agent.question.send"))
    expect(answer).toHaveBeenCalledWith("The second one.")
  })

  it("explains an unexpected browser-control disconnect", () => {
    render(
      <AgentView
        privacyAcknowledged
        run={{
          ...run("paused"),
          pauseReason: "browser_disconnected"
        }}
      />
    )

    expect(screen.getByText("agent.browser_disconnected")).toBeInTheDocument()
    expect(screen.getByText("agent.controls.resume")).toBeInTheDocument()
  })

  it("offers to widen only an approval that came with an offer", () => {
    const approve = vi.fn()
    const request = {
      id: "approval-1",
      runId: "agent-1",
      stepId: "agent-1:1",
      risk: "high" as const,
      action: "Allow click",
      consequence: "The browser will perform the resolved page effect.",
      createdAt: 1
    }

    const { rerender } = render(
      <AgentView
        approval={request}
        onApprove={approve}
        privacyAcknowledged
        run={run("awaiting_approval")}
      />
    )
    // Whether an effect may be pre-authorized is policy's answer, so a
    // request with no offer must not grow one in the panel.
    expect(screen.queryByText(/allowForRun/)).not.toBeInTheDocument()

    rerender(
      <AgentView
        approval={{
          ...request,
          origin: "https://example.com",
          grantable: ["activation"]
        }}
        onApprove={approve}
        privacyAcknowledged
        run={run("awaiting_approval")}
      />
    )
    fireEvent.click(screen.getByText(/allowForRun/))
    expect(approve).toHaveBeenCalledWith("run_origin")
  })
})
