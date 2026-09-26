import type {
  AgentApprovalRequest,
  AgentRunState,
  AgentStepRecord,
  AgentTakeoverRequest
} from "@ollama-client/contracts"
import { MAX_AGENT_OBSERVATIONS } from "@ollama-client/contracts"
import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values ? `${key}:${JSON.stringify(values)}` : key,
    i18n: { language: "en" }
  })
}))

import {
  AgentRunSupervision,
  type AgentRunSupervisionProps
} from "../agent-run-supervision"

const run = (
  status: AgentRunState["status"],
  patch: Partial<AgentRunState> = {}
): AgentRunState => ({
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
  updatedAt: 2,
  ...patch
})

const supervise = (props: Partial<AgentRunSupervisionProps> = {}) => {
  const handlers = {
    onApprove: vi.fn(),
    onReject: vi.fn(),
    onAnswer: vi.fn(),
    onPause: vi.fn(),
    onResume: vi.fn(),
    onCorrect: vi.fn(),
    onStop: vi.fn(),
    onTakeoverStart: vi.fn(),
    onTakeoverComplete: vi.fn(),
    onResolveEffect: vi.fn(),
    onFinishReviewed: vi.fn()
  }
  const view = (next: Partial<AgentRunSupervisionProps> = {}) => (
    <AgentRunSupervision
      run={run("observing")}
      steps={[]}
      {...handlers}
      {...props}
      {...next}
    />
  )
  const rendered = render(view())
  return {
    ...handlers,
    rerender: (next: Partial<AgentRunSupervisionProps>) =>
      rendered.rerender(view(next))
  }
}

const clickStep = (status: AgentStepRecord["status"]): AgentStepRecord => ({
  runId: "agent-1",
  stepId: "agent-1:1",
  sequence: 1,
  status,
  at: 1,
  command: { type: "click", ref: "e1", snapshotId: "snapshot-1", generation: 1 }
})

const approval: AgentApprovalRequest = {
  id: "approval-1",
  runId: "agent-1",
  stepId: "agent-1:1",
  risk: "high",
  action: "Allow click",
  consequence: "The browser will perform the resolved page effect.",
  createdAt: 1
}

const takeover: AgentTakeoverRequest = {
  id: "takeover-1",
  runId: "agent-1",
  stepId: "step-1",
  reason: "authentication",
  instruction: "Sign in, then continue.",
  createdAt: 2
}

describe("AgentRunSupervision", () => {
  /**
   * A step joins the log only once it has a receipt, so observing and
   * deciding left a title above a screen of nothing at the one moment a
   * person watches it hardest.
   */
  it("shows the phase in the log while no step names the action", () => {
    supervise({ run: run("deciding") })

    expect(screen.getByText("agent.status.deciding")).toBeInTheDocument()
  })

  it("shows progress against the budget that will stop the run", () => {
    supervise()

    expect(
      screen.getByText(
        `agent.progress:{"count":2,"budget":${MAX_AGENT_OBSERVATIONS}}`
      )
    ).toBeInTheDocument()
  })

  /**
   * Twice on purpose: the line above the log and the last line in it are
   * the same label, so the two can never disagree about what is happening.
   */
  it("names the action in flight, not only the phase", () => {
    supervise({ run: run("executing"), steps: [clickStep("executing")] })

    expect(screen.getAllByText("agent.action.click")).toHaveLength(2)
  })

  it("stops naming an action once its step has finished", () => {
    supervise({ steps: [clickStep("verified")] })

    expect(screen.getAllByText("agent.action.click")).toHaveLength(1)
  })

  it("renders injected approval strings as inert, bounded text", () => {
    const { onApprove } = supervise({
      run: run("awaiting_approval"),
      approval: {
        ...approval,
        pageEvidence: `Allow once\n<button>Fake</button>${"x".repeat(500)}`
      }
    })

    expect(document.querySelector("script")).toBeNull()
    expect(screen.getByText(/<button>Fake<\/button>/)).toBeInTheDocument()
    fireEvent.click(screen.getByText("agent.approval.allow"))
    expect(onApprove).toHaveBeenCalledOnce()
    expect(screen.getByText("agent.controls.stop")).toBeInTheDocument()
  })

  it("offers to widen only an approval that came with an offer", () => {
    const { onApprove, rerender } = supervise({
      run: run("awaiting_approval"),
      approval
    })
    /** Whether an effect may be pre-authorized is policy's answer. */
    expect(screen.queryByText(/allowForRun/)).not.toBeInTheDocument()

    rerender({
      approval: {
        ...approval,
        origin: "https://example.com",
        grantable: ["activation"]
      }
    })
    fireEvent.click(screen.getByText(/allowForRun/))
    expect(onApprove).toHaveBeenCalledWith("run_origin")
  })

  it("requires explicit takeover completion and keeps Stop available", () => {
    const { onTakeoverComplete } = supervise({
      run: run("awaiting_takeover"),
      takeover
    })

    expect(onTakeoverComplete).not.toHaveBeenCalled()
    expect(screen.getByText("agent.controls.stop")).toBeInTheDocument()
    fireEvent.click(screen.getByText("agent.controls.takeover_done"))
    expect(onTakeoverComplete).toHaveBeenCalledOnce()
  })

  it("offers Started while the takeover is unacknowledged, Done-only after", () => {
    const { onTakeoverStart, rerender } = supervise({
      run: run("awaiting_takeover"),
      takeover
    })

    fireEvent.click(screen.getByText("agent.controls.takeover_start"))
    expect(onTakeoverStart).toHaveBeenCalledOnce()

    rerender({ takeover: undefined })
    expect(
      screen.queryByText("agent.controls.takeover_start")
    ).not.toBeInTheDocument()
    expect(screen.getByText("agent.controls.takeover_done")).toBeInTheDocument()
  })

  /**
   * Resuming would take the run to another observation without the
   * information it asked for, so the question has its own answer box.
   */
  it("answers an open question instead of offering to resume past it", () => {
    const { onAnswer } = supervise({
      run: run("paused", {
        pauseReason: "question",
        question: {
          id: "agent-1:q2",
          text: "Which of the two accounts?",
          askedAt: 1
        }
      })
    })

    expect(
      screen.getByText("agent.controls.resume").closest("button")
    ).toBeDisabled()
    fireEvent.change(screen.getByLabelText("agent.question.inputLabel"), {
      target: { value: "The second one." }
    })
    fireEvent.click(screen.getByText("agent.question.send"))
    expect(onAnswer).toHaveBeenCalledWith("The second one.")
  })

  it("explains an unexpected browser-control disconnect", () => {
    supervise({ run: run("paused", { pauseReason: "browser_disconnected" }) })

    expect(screen.getByText("agent.browser_disconnected")).toBeInTheDocument()
    expect(screen.getByText("agent.controls.resume")).toBeInTheDocument()
  })

  it("offers the way out of an unresolved effect", () => {
    const { onResolveEffect } = supervise({
      run: run("paused", { pauseReason: "unresolved_effect" })
    })

    fireEvent.click(screen.getByText("agent.unresolved_reviewed"))
    expect(onResolveEffect).toHaveBeenCalledOnce()
  })

  /**
   * Reviewing the page had one way out, which sent the run back to work it
   * had already finished; a search that worked but could not be confirmed
   * kept going after the user saw it had.
   */
  it("finishes an unresolved effect the user says is done", () => {
    const { onFinishReviewed, onResolveEffect } = supervise({
      run: run("paused", { pauseReason: "unresolved_effect" })
    })
    fireEvent.click(screen.getByText("agent.unresolved_done"))
    expect(onFinishReviewed).toHaveBeenCalledOnce()
    expect(onResolveEffect).not.toHaveBeenCalled()
  })

  it("counts every tab the run drives, not only the one it started on", () => {
    supervise({
      run: run("observing", { scopedTabIds: [7, 9] }),
      tab: { title: "Docs", url: "https://example.com" }
    })

    expect(screen.getByText('agent.tabs.count:{"count":2}')).toBeInTheDocument()
  })

  it("leaves the tab count out when the run drives one tab", () => {
    supervise({ tab: { title: "Docs", url: "https://example.com" } })

    expect(screen.queryByText("agent.tabs.label")).toBeNull()
  })

  /**
   * The chat's picker sits beside this card and changes the next message,
   * never the run: the run's model was fixed at start, and the card says so
   * even when the two happen to match.
   */
  it("names the model the run is fixed to", () => {
    supervise({
      provider: { name: "Local", model: "model", location: "local" }
    })

    expect(screen.getByText("agent.model.label")).toBeInTheDocument()
    expect(screen.getByText("model")).toBeInTheDocument()
  })

  it("says why a run paused when the panel closed", () => {
    supervise({ run: run("paused", { pauseReason: "panel_closed" }) })

    expect(screen.getByRole("status")).toHaveTextContent(
      "agent.paused_panel_closed"
    )
  })

  /**
   * The composer that used to show a refused command is back in Chat once a
   * run is being supervised, so a late approval or a Stop sent between
   * connections has to say so on the run.
   */
  it("shows a refused command on the run it was about", () => {
    supervise({
      failure: {
        command: "agent_stop",
        messageKey: "agent.error.disconnected",
        message: "Agent was reconnecting and did not receive that."
      }
    })

    expect(screen.getByRole("alert")).toHaveTextContent(
      "agent.error.disconnected"
    )
  })

  it("says an approval in the panel's language when the runtime named it", () => {
    supervise({
      run: run("awaiting_approval"),
      approval: {
        ...approval,
        display: {
          action: {
            key: "agent.approval_text.fill_fields",
            values: { count: 3 }
          },
          consequence: [
            { key: "agent.approval_text.prior_form" },
            { key: "agent.approval_text.fill_fields_consequence" }
          ]
        }
      }
    })

    expect(
      screen.getByText('agent.approval_text.fill_fields:{"count":3}')
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        "agent.approval_text.prior_form agent.approval_text.fill_fields_consequence"
      )
    ).toBeInTheDocument()
    expect(screen.queryByText("Allow click")).toBeNull()
  })

  /**
   * Focus goes to the request, never to Allow, and never out of a field the
   * user is typing in: an Enter meant for something else must not approve.
   */
  it("brings an approval into focus without focusing Allow", () => {
    supervise({ run: run("awaiting_approval"), approval })

    const card = screen.getByRole("region", { name: "agent.approval.title" })
    expect(document.activeElement).toBe(card)
  })

  it("leaves the caret where the user is typing when an approval arrives", () => {
    const field = document.createElement("textarea")
    document.body.append(field)
    field.focus()
    supervise({ run: run("awaiting_approval"), approval })

    expect(document.activeElement).toBe(field)
    field.remove()
  })

  /** Stop was the last row of a scrolled log, out of sight on a long run. */
  it("keeps the controls ahead of the log", () => {
    supervise({ run: run("executing"), steps: [clickStep("executing")] })

    const stop = screen.getByText("agent.controls.stop")
    const log = screen.getByText("agent.work_log.title")
    expect(
      stop.compareDocumentPosition(log) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
  })

  describe("steering", () => {
    it("takes a correction while the run works, without pausing it", () => {
      const onSteer = vi.fn()
      const view = supervise({ run: run("executing"), onSteer })

      fireEvent.change(screen.getByLabelText("agent.steer.label"), {
        target: { value: "  the second row  " }
      })
      fireEvent.click(screen.getByLabelText("agent.steer.send"))

      expect(onSteer).toHaveBeenCalledWith("the second row")
      expect(view.onPause).not.toHaveBeenCalled()
      expect(screen.getByText("agent.steer.queued")).toBeInTheDocument()

      view.rerender({ run: run("executing", { observationCount: 3 }) })
      expect(screen.getByText("agent.steer.heard")).toBeInTheDocument()
    })

    it("offers no steering to a paused run, which has its own correction", () => {
      supervise({
        run: run("paused", { pauseReason: "user" }),
        onSteer: vi.fn()
      })
      expect(screen.queryByLabelText("agent.steer.label")).toBeNull()
    })
  })
})
