import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values ? `${key}:${JSON.stringify(values)}` : key
  })
}))

import {
  AgentActPreflight,
  type AgentActPreflightProps
} from "../agent-act-preflight"

const preflight = (props: Partial<AgentActPreflightProps> = {}) => {
  const handlers = {
    onClearFollowUp: vi.fn(),
    onAcknowledgePrivacy: vi.fn(),
    onAllowRoutineActions: vi.fn(),
    onAllowExperimentalModel: vi.fn()
  }
  render(
    <AgentActPreflight
      runInProgress={false}
      showRemoteNotice={false}
      allowRoutineActions
      allowExperimentalModel={false}
      {...handlers}
      {...props}
    />
  )
  return handlers
}

describe("AgentActPreflight", () => {
  it("says the run will attach a debugger before it is started", () => {
    preflight({
      browser: {
        backend: "cdp",
        attaches: true,
        nativeInput: true,
        screenshots: true,
        dialogs: true
      }
    })

    expect(screen.getByText("agent.attachment.attaches")).toBeInTheDocument()
    expect(screen.queryByText("agent.limits.no_native_input")).toBeNull()
  })

  it("names what a browser without a debugger cannot do", () => {
    preflight({
      browser: {
        backend: "dom",
        attaches: false,
        nativeInput: false,
        screenshots: false,
        dialogs: false
      }
    })

    expect(screen.getByText("agent.attachment.no_debugger")).toBeInTheDocument()
    expect(screen.getByText("agent.limits.no_native_input")).toBeInTheDocument()
    expect(screen.getByText("agent.limits.no_screenshots")).toBeInTheDocument()
    expect(screen.getByText("agent.limits.no_dialogs")).toBeInTheDocument()
  })

  it("names the vision state a text-only model runs under", () => {
    preflight({
      provider: {
        name: "Local",
        model: "qwen3",
        location: "local",
        screenshots: false,
        readiness: {
          status: "ready",
          reason: "metadata",
          vision: "unsupported"
        }
      }
    })

    expect(screen.getByText("agent.readiness.status.ready")).toBeInTheDocument()
    expect(
      screen.getByText("agent.readiness.vision.unsupported")
    ).toBeInTheDocument()
    expect(screen.getByText("agent.readiness.text_only")).toBeInTheDocument()
  })

  it("asks about observations alone when no picture can travel", () => {
    const { onAcknowledgePrivacy } = preflight({
      showRemoteNotice: true,
      provider: {
        name: "Remote",
        model: "qwen3",
        location: "remote",
        screenshots: false
      }
    })

    expect(screen.getByText("agent.privacy.remote_notice")).toBeInTheDocument()
    fireEvent.click(screen.getByText("agent.privacy.acknowledge"))
    expect(onAcknowledgePrivacy).toHaveBeenCalledWith("observations")
  })

  it("asks about screenshots whenever they may travel, unknown included", () => {
    const { onAcknowledgePrivacy } = preflight({
      showRemoteNotice: true,
      provider: { name: "Remote", model: "llava", location: "remote" }
    })

    expect(
      screen.getByText("agent.privacy.remote_notice_screenshots")
    ).toBeInTheDocument()
    fireEvent.click(screen.getByText("agent.privacy.acknowledge"))
    expect(onAcknowledgePrivacy).toHaveBeenCalledWith("screenshots")
  })

  it("carries the routine-actions consent", () => {
    const { onAllowRoutineActions } = preflight()

    fireEvent.click(
      screen.getByRole("checkbox", { name: /agent\.start\.auto_actions/ })
    )
    expect(onAllowRoutineActions).toHaveBeenCalledWith(false)
  })

  it("names the run a follow-up continues, and lets the user drop it", () => {
    const { onClearFollowUp } = preflight({
      followUp: {
        parentRunId: "parent",
        mode: "continue",
        parentGoal: "Find the <b>blue</b> mug"
      }
    })

    expect(
      screen.getByText(
        'agent.follow_up.continue:{"goal":"Find the <b>blue</b> mug"}'
      )
    ).toBeInTheDocument()
    fireEvent.click(
      screen.getByRole("button", { name: "agent.follow_up.clear" })
    )
    expect(onClearFollowUp).toHaveBeenCalledOnce()
  })

  it("says a second run cannot start beside a live one", () => {
    preflight({ runInProgress: true })

    expect(
      screen.getByText("agent.composer.run_in_progress")
    ).toBeInTheDocument()
  })

  it("shows why a start was refused", () => {
    preflight({
      failure: {
        command: "agent_start",
        messageKey: "agent.error.tab_unsupported",
        message: "x"
      }
    })

    expect(screen.getByRole("alert")).toHaveTextContent(
      "agent.error.tab_unsupported"
    )
  })
})
