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

describe("AgentView disclosure and supervision", () => {
  it("says the run will attach a debugger before it is started", () => {
    // Chromium shows its own debugging banner the moment a run attaches, and
    // a banner with nothing beside it is what sends someone to ask a
    // developer what their extension is doing.
    render(
      <AgentView
        browser={{
          backend: "cdp",
          attaches: true,
          nativeInput: true,
          screenshots: true,
          dialogs: true
        }}
      />
    )
    expect(screen.getByText("agent.attachment.attaches")).toBeTruthy()
    expect(screen.queryByText("agent.limits.no_native_input")).toBeNull()
  })

  it("names what a browser without a debugger cannot do", () => {
    render(
      <AgentView
        browser={{
          backend: "dom",
          attaches: false,
          nativeInput: false,
          screenshots: false,
          dialogs: false
        }}
      />
    )
    expect(screen.getByText("agent.attachment.no_debugger")).toBeTruthy()
    expect(screen.getByText("agent.limits.no_native_input")).toBeTruthy()
    expect(screen.getByText("agent.limits.no_screenshots")).toBeTruthy()
    expect(screen.getByText("agent.limits.no_dialogs")).toBeTruthy()
  })

  it("shows progress against the budget that will stop the run", () => {
    // A bare count cannot say whether a run is halfway or about to be cut off.
    render(<AgentView run={run("observing")} />)
    expect(
      screen.getByText('agent.progress:{"count":2,"budget":25}')
    ).toBeTruthy()
  })

  it("names the action in flight, not only the phase", () => {
    render(
      <AgentView
        run={run("executing")}
        steps={[
          {
            runId: "agent-1",
            stepId: "agent-1:1",
            sequence: 1,
            status: "executing",
            at: 1,
            command: {
              type: "click",
              ref: "e1",
              snapshotId: "snapshot-1",
              generation: 1
            }
          }
        ]}
      />
    )
    // Twice on purpose: the line above the log and the last line in it are
    // the same label, so the two can never disagree about what is happening.
    expect(screen.getAllByText("Click control")).toHaveLength(2)
  })

  it("counts every tab the run drives, not only the one it started on", () => {
    render(
      <AgentView
        run={{ ...run("observing"), scopedTabIds: [7, 9] }}
        tab={{ title: "Docs", url: "https://example.com" }}
      />
    )
    expect(screen.getByText('agent.tabs.count:{"count":2}')).toBeTruthy()
  })

  it("leaves the tab count out when the run drives one tab", () => {
    render(
      <AgentView
        run={run("observing")}
        tab={{ title: "Docs", url: "https://example.com" }}
      />
    )
    expect(screen.queryByText("agent.tabs.label")).toBeNull()
  })

  it("says what to do about a failure before repeating what happened", () => {
    render(
      <AgentView
        run={{
          ...run("failed"),
          error: {
            code: "model_unavailable",
            message: "The selected model could not produce a decision.",
            retryable: false
          }
        }}
      />
    )
    // The advice is the answer; the runtime's own English sentence is kept
    // underneath, because whoever reports the problem needs its words.
    expect(screen.getByText("agent.failure.model_unavailable")).toBeTruthy()
    expect(
      screen.getByText("The selected model could not produce a decision.")
    ).toBeTruthy()
  })

  it("still advises on a failure code it does not know", () => {
    render(
      <AgentView
        run={{
          ...run("failed"),
          error: {
            code: "budget_exhausted",
            message: "x",
            retryable: false
          }
        }}
      />
    )
    expect(screen.getByText("agent.failure.budget_exhausted")).toBeTruthy()
  })
})
