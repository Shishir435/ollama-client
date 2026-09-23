import type {
  AgentPanelSnapshot,
  AgentRunState
} from "@ollama-client/contracts"
import { act, fireEvent, render, screen } from "@testing-library/react"
import { useState } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values ? `${key}:${JSON.stringify(values)}` : key
  })
}))

const settings = vi.hoisted(() => ({ acknowledged: true as boolean }))
vi.mock("@/hooks/use-setting", () => ({
  useSetting: () => [settings.acknowledged, vi.fn()]
}))

const sessions = vi.hoisted(() => ({
  currentSessionId: "s-1" as string | null,
  createSession: vi.fn(async () => undefined),
  loadSessionMessages: vi.fn(async () => undefined)
}))
vi.mock("@/features/sessions/stores/chat-session-store", () => ({
  useChatSessions: () => sessions,
  chatSessionStore: { getState: () => sessions }
}))

vi.mock("@/features/model/hooks/use-provider-models", () => ({
  useProviderModels: () => ({
    selectedModel: "qwen3",
    selectedProviderId: "ollama"
  })
}))

vi.mock("../hooks/use-agent-candidate-tab", () => ({
  useAgentCandidateTab: () => ({
    id: 7,
    title: "Example",
    url: "https://example.com"
  })
}))

vi.mock("../hooks/use-agent-debug-report", () => ({
  useAgentDebugReport: () => undefined
}))

const port = vi.hoisted(() => ({
  snapshot: { steps: [] } as AgentPanelSnapshot,
  failure: undefined as
    | { command: string; messageKey: string; message: string }
    | undefined,
  start: vi.fn()
}))
vi.mock("../hooks/use-agent-run", () => ({
  useAgentRun: () => ({
    snapshot: port.snapshot,
    failure: port.failure,
    busy: false,
    debugReport: undefined,
    start: port.start,
    answerQuestion: vi.fn(),
    approve: vi.fn(),
    reject: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    correct: vi.fn(),
    stop: vi.fn(),
    beginTakeover: vi.fn(),
    completeTakeover: vi.fn(),
    resolveEffect: vi.fn()
  })
}))

import { AgentWorkspace } from "../agent-workspace"
import { agentDraftStore } from "../stores/agent-draft-store"

const readyProvider: AgentPanelSnapshot["provider"] = {
  name: "Local",
  model: "qwen3",
  location: "local",
  readiness: { status: "ready", reason: "metadata", vision: "unknown" }
}

const run = (patch: Partial<AgentRunState> = {}): AgentRunState => ({
  version: 1,
  id: "run-2",
  goal: "Close this issue",
  status: "observing",
  stepCount: 0,
  observationCount: 0,
  controlledTabId: 7,
  providerId: "ollama",
  modelId: "qwen3",
  allowedOrigins: ["https://example.com"],
  createdAt: 1,
  updatedAt: 1,
  ...patch
})

/**
 * A stand-in for the chat composer: the mode's words on the field, its
 * Start in place of Send, and its preflight above — the three places the
 * real composer consults it.
 */
const Composer = () => {
  const [text, setText] = useState("")
  return (
    <AgentWorkspace>
      {({ toggle, mode }) => (
        <div>
          {mode.active && mode.preflight}
          {toggle}
          <span data-testid="mode">{mode.active ? "act" : "chat"}</span>
          <span data-testid="prefill">{mode.prefill?.text ?? ""}</span>
          <textarea
            aria-label={mode.active ? mode.inputLabel : "message"}
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
          <button
            type="button"
            disabled={!mode.canSubmit(text.trim())}
            onClick={() => mode.submit(text.trim())}>
            {mode.submitLabel}
          </button>
        </div>
      )}
    </AgentWorkspace>
  )
}

const write = (text: string) =>
  fireEvent.change(screen.getByLabelText("agent.start.goal"), {
    target: { value: text }
  })
const startButton = () =>
  screen.getByRole("button", { name: "agent.start.action" })

beforeEach(() => {
  settings.acknowledged = true
  sessions.currentSessionId = "s-1"
  sessions.createSession.mockClear()
  sessions.loadSessionMessages.mockClear()
  port.snapshot = { steps: [], provider: readyProvider }
  port.failure = undefined
  port.start.mockReset()
  agentDraftStore.setState({
    acting: true,
    prefill: undefined,
    followUp: undefined
  })
})

describe("the Agent in the chat workspace", () => {
  it("starts a task from the composer, with routine actions by default", () => {
    render(<Composer />)

    write("Close this issue")
    fireEvent.click(startButton())

    expect(port.start).toHaveBeenCalledWith("Close this issue", true, undefined)
  })

  it("starts one run for two rapid submissions", () => {
    render(<Composer />)

    write("Close this issue")
    fireEvent.click(startButton())
    fireEvent.click(startButton())

    expect(port.start).toHaveBeenCalledOnce()
  })

  it("starts without routine actions once the user unticks them", () => {
    render(<Composer />)

    fireEvent.click(
      screen.getByRole("checkbox", { name: /agent\.start\.auto_actions/ })
    )
    write("Close this issue")
    fireEvent.click(startButton())

    expect(port.start).toHaveBeenCalledWith(
      "Close this issue",
      false,
      undefined
    )
  })

  /**
   * The same union the run is refused by: Start was live for a model that
   * cannot call tools, so the refusal arrived after the run had attached to
   * a tab and spent an observation.
   */
  it("refuses to start a model the run would refuse at planning time", () => {
    port.snapshot = {
      steps: [],
      provider: {
        ...readyProvider,
        readiness: {
          status: "unsupported",
          reason: "reported_unsupported",
          vision: "unknown"
        }
      }
    }
    render(<Composer />)

    write("Close this issue")
    expect(startButton()).toBeDisabled()
  })

  it("starts an experimental model only once the user opts in", () => {
    port.snapshot = {
      steps: [],
      provider: {
        ...readyProvider,
        readiness: {
          status: "experimental",
          reason: "user_override",
          vision: "unknown"
        }
      }
    }
    render(<Composer />)
    write("Close this issue")
    expect(startButton()).toBeDisabled()

    fireEvent.click(
      screen
        .getByText("agent.readiness.allow_experimental")
        .closest("label")
        ?.querySelector("input") as HTMLElement
    )
    expect(startButton()).toBeEnabled()
  })

  it("holds Start until a remote model's notice is acknowledged", () => {
    settings.acknowledged = false
    port.snapshot = {
      steps: [],
      provider: { ...readyProvider, location: "remote", screenshots: false }
    }
    render(<Composer />)

    write("Compare these products")
    expect(startButton()).toBeDisabled()
    expect(screen.getByText("agent.privacy.remote_notice")).toBeInTheDocument()
  })

  it("refuses a second run beside one that is still working", () => {
    port.snapshot = { steps: [], provider: readyProvider, run: run() }
    render(<Composer />)

    write("Another task")
    expect(startButton()).toBeDisabled()
    expect(
      screen.getByText("agent.composer.run_in_progress")
    ).toBeInTheDocument()
  })

  it("names the run a follow-up follows on Start", () => {
    agentDraftStore.getState().beginDraft("", {
      parentRunId: "parent",
      mode: "continue",
      parentGoal: "Find the mug"
    })
    render(<Composer />)

    write("Now the second one")
    fireEvent.click(startButton())

    expect(port.start).toHaveBeenCalledWith("Now the second one", true, {
      parentRunId: "parent",
      mode: "continue"
    })
    expect(agentDraftStore.getState().followUp?.submitted).toEqual({})
  })

  /**
   * Once the run it started is showing, the composer goes back to chat: the
   * run is supervised from its card, and the next thing typed is most often
   * a message about it.
   */
  it("goes back to Chat once the run it started is showing", () => {
    const view = render(<Composer />)
    write("Close this issue")
    fireEvent.click(startButton())
    expect(screen.getByTestId("mode")).toHaveTextContent("act")

    port.snapshot = { steps: [], provider: readyProvider, run: run() }
    view.rerender(<Composer />)

    expect(screen.getByTestId("mode")).toHaveTextContent("chat")
  })

  it("puts the goal back when the start is refused", () => {
    const view = render(<Composer />)
    write("Close this issue")
    fireEvent.click(startButton())

    port.failure = {
      command: "agent_start",
      messageKey: "agent.error.tab_unsupported",
      message: "x"
    }
    view.rerender(<Composer />)

    expect(screen.getByTestId("mode")).toHaveTextContent("act")
    expect(screen.getByTestId("prefill")).toHaveTextContent("Close this issue")
    expect(screen.getByRole("alert")).toHaveTextContent(
      "agent.error.tab_unsupported"
    )
  })

  /**
   * On a fresh install there is no chat and so no composer: the switch
   * makes one, or the Agent would be unreachable until the user had started
   * a conversation they did not want.
   */
  it("makes a chat when switched to Act with none open", async () => {
    agentDraftStore.setState({ acting: false })
    sessions.currentSessionId = null
    render(<Composer />)

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", {
          name: "agent.surface.agent · agent.surface.preview"
        })
      )
    })

    expect(sessions.createSession).toHaveBeenCalledOnce()
    expect(agentDraftStore.getState().acting).toBe(true)
  })

  it("makes one chat however many times the switch is pressed meanwhile", async () => {
    agentDraftStore.setState({ acting: false })
    sessions.currentSessionId = null
    let finish: () => void = () => undefined
    sessions.createSession.mockImplementationOnce(
      () =>
        new Promise<undefined>((resolve) => {
          finish = () => resolve(undefined)
        })
    )
    render(<Composer />)
    const toggle = screen.getByRole("button", {
      name: "agent.surface.agent · agent.surface.preview"
    })

    fireEvent.click(toggle)
    fireEvent.click(toggle)
    await act(async () => finish())

    expect(sessions.createSession).toHaveBeenCalledOnce()
  })

  /**
   * The background writes a run's request and card in the commit that admits
   * it. The conversation on screen never saw them, so it is re-read, or the
   * card carrying the run's approvals would stay hidden.
   */
  it("re-reads the open chat when a run it has not shown appears", () => {
    const view = render(<Composer />)
    sessions.loadSessionMessages.mockClear()

    port.snapshot = { steps: [], provider: readyProvider, run: run() }
    view.rerender(<Composer />)
    view.rerender(<Composer />)

    expect(sessions.loadSessionMessages).toHaveBeenCalledOnce()
    expect(sessions.loadSessionMessages).toHaveBeenCalledWith("s-1")
  })
})
