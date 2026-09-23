import type { AgentRunState } from "@ollama-client/contracts"
import type { AgentRunCard } from "@ollama-client/contracts/agent-rpc"
import { fireEvent, render, screen } from "@testing-library/react"
import type { ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { ChatMessage } from "@/types"
import type { AgentRunConnection } from "../../hooks/use-agent-run"
import { AgentChatComposerContext } from "../../lib/agent-chat-composer"
import { AgentConnectionContext } from "../../lib/agent-connection"
import { agentDraftStore } from "../../stores/agent-draft-store"

const useAgentRunCard = vi.hoisted(() => vi.fn())

vi.mock("../../hooks/use-agent-run-card", () => ({ useAgentRunCard }))
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values ? `${key}:${JSON.stringify(values)}` : key
  })
}))

import { AgentRunMessageCard } from "../agent-run-message-card"

const message = (content = ""): ChatMessage => ({
  id: 7,
  role: "assistant",
  content,
  agentRunId: "run-1"
})

const card = (patch: Partial<AgentRunCard> = {}): AgentRunCard => ({
  id: "run-1",
  goal: "Find the opening hours",
  status: "executing",
  stepCount: 3,
  updatedAt: 1,
  ...patch
})

const liveRun = (patch: Partial<AgentRunState> = {}): AgentRunState => ({
  version: 1,
  id: "run-1",
  goal: "Find the opening hours",
  status: "awaiting_approval",
  stepCount: 1,
  observationCount: 1,
  controlledTabId: 7,
  providerId: "ollama",
  modelId: "qwen3",
  allowedOrigins: ["https://example.com"],
  createdAt: 1,
  updatedAt: 2,
  ...patch
})

const connection = (run?: AgentRunState): AgentRunConnection =>
  ({
    snapshot: {
      steps: [],
      ...(run ? { run } : {}),
      ...(run?.status === "awaiting_approval"
        ? {
            pending: {
              kind: "approval",
              request: {
                id: "approval-1",
                runId: run.id,
                stepId: `${run.id}:1`,
                risk: "high",
                action: "Allow click",
                consequence: "The browser will click.",
                createdAt: 1
              }
            }
          }
        : {})
    },
    busy: false,
    start: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    correct: vi.fn(),
    debugReport: vi.fn(),
    stop: vi.fn(),
    completeTakeover: vi.fn(),
    resolveEffect: vi.fn(),
    approve: vi.fn(),
    reject: vi.fn(),
    answerQuestion: vi.fn(),
    beginTakeover: vi.fn()
  }) as unknown as AgentRunConnection

/** The card as the side panel mounts it: a workspace port and chat's Ask. */
const inWorkspace = (
  children: ReactNode,
  port: AgentRunConnection = connection(),
  ask: () => void = vi.fn()
) => (
  <AgentConnectionContext.Provider value={{ connection: port }}>
    <AgentChatComposerContext.Provider value={ask}>
      {children}
    </AgentChatComposerContext.Provider>
  </AgentConnectionContext.Provider>
)

beforeEach(() => {
  useAgentRunCard.mockReset()
  agentDraftStore.setState({
    acting: false,
    prefill: undefined,
    followUp: undefined
  })
})

describe("AgentRunMessageCard", () => {
  it("reads the run its message names", () => {
    useAgentRunCard.mockReturnValue({ kind: "loading" })
    render(<AgentRunMessageCard msg={message()} />)

    expect(useAgentRunCard).toHaveBeenCalledWith("run-1")
    expect(screen.getByText("agent.card.loading")).toBeInTheDocument()
  })

  it("shows a run's status and step count read from its row", () => {
    useAgentRunCard.mockReturnValue({ kind: "ready", run: card() })
    render(<AgentRunMessageCard msg={message()} />)

    expect(screen.getByText("agent.status.executing")).toBeInTheDocument()
    expect(screen.getByText('agent.card.steps:{"count":3}')).toBeInTheDocument()
  })

  /**
   * There is no other surface to supervise from: the run the panel's port
   * holds is approved, answered and stopped from its card, each decision
   * with its own control.
   */
  it("supervises the live run from its card", () => {
    useAgentRunCard.mockReturnValue({
      kind: "ready",
      run: card({ status: "executing" })
    })
    const port = connection(liveRun())
    render(inWorkspace(<AgentRunMessageCard msg={message()} />, port))

    /** The port's status, not the row's: it is pushed, the row is polled. */
    expect(
      screen.getAllByText("agent.status.awaiting_approval").length
    ).toBeGreaterThan(0)
    expect(screen.queryByText("agent.status.executing")).not.toBeInTheDocument()
    fireEvent.click(screen.getByText("agent.approval.allow"))
    expect(port.approve).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByText("agent.controls.stop"))
    expect(port.stop).toHaveBeenCalledOnce()
  })

  it("does not supervise a run the port does not hold", () => {
    useAgentRunCard.mockReturnValue({ kind: "ready", run: card() })
    render(
      inWorkspace(
        <AgentRunMessageCard msg={message()} />,
        connection(liveRun({ id: "other-run" }))
      )
    )

    expect(screen.queryByText("agent.approval.allow")).not.toBeInTheDocument()
    expect(screen.getByText("agent.status.executing")).toBeInTheDocument()
  })

  it("shows a settled run's result and outcome", () => {
    useAgentRunCard.mockReturnValue({
      kind: "ready",
      run: card({
        status: "partial",
        result: "Open 9 to 5 on weekdays.",
        outcome: { met: 1, total: 2 }
      })
    })
    render(inWorkspace(<AgentRunMessageCard msg={message()} />))

    expect(screen.getByText("Open 9 to 5 on weekdays.")).toBeInTheDocument()
    expect(
      screen.getByText(/agent\.card\.outcome:\{"met":1,"total":2\}/)
    ).toBeInTheDocument()
  })

  it("continues a run that got somewhere, in Act mode with an empty box", () => {
    useAgentRunCard.mockReturnValue({
      kind: "ready",
      run: card({ status: "completed" })
    })
    render(inWorkspace(<AgentRunMessageCard msg={message()} />))

    expect(
      screen.queryByRole("button", { name: "agent.card.retry" })
    ).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "agent.card.continue" }))

    expect(agentDraftStore.getState()).toMatchObject({
      acting: true,
      prefill: { text: "" },
      followUp: {
        parentRunId: "run-1",
        mode: "continue",
        parentGoal: "Find the opening hours"
      }
    })
  })

  it("retries a run that stopped short with its own goal", () => {
    useAgentRunCard.mockReturnValue({
      kind: "ready",
      run: card({
        status: "failed",
        error: { code: "goal_failed" }
      })
    })
    render(inWorkspace(<AgentRunMessageCard msg={message()} />))

    fireEvent.click(screen.getByRole("button", { name: "agent.card.retry" }))

    expect(agentDraftStore.getState()).toMatchObject({
      acting: true,
      prefill: { text: "Find the opening hours" },
      followUp: { parentRunId: "run-1", mode: "retry" }
    })
  })

  /**
   * Starting over reuses the sentence and nothing else: no parent, so the
   * background carries no record and the run claims to know nothing.
   */
  it("starts over as a fresh run that follows nothing", () => {
    agentDraftStore.setState({
      followUp: {
        parentRunId: "older",
        mode: "continue",
        parentGoal: "Older task"
      }
    })
    useAgentRunCard.mockReturnValue({
      kind: "ready",
      run: card({ status: "cancelled" })
    })
    render(inWorkspace(<AgentRunMessageCard msg={message()} />))

    fireEvent.click(
      screen.getByRole("button", { name: "agent.card.start_over" })
    )

    expect(agentDraftStore.getState().prefill?.text).toBe(
      "Find the opening hours"
    )
    expect(agentDraftStore.getState().followUp).toBeUndefined()
  })

  /**
   * Answer-only is the default route: a question about the run is a chat
   * message, so Ask leaves Act mode and hands the caret to the composer.
   */
  it("asks about a settled run in chat, leaving Act mode", () => {
    agentDraftStore.setState({ acting: true })
    useAgentRunCard.mockReturnValue({
      kind: "ready",
      run: card({ status: "completed" })
    })
    const ask = vi.fn()
    render(inWorkspace(<AgentRunMessageCard msg={message()} />, undefined, ask))

    fireEvent.click(screen.getByRole("button", { name: "agent.card.ask" }))

    expect(ask).toHaveBeenCalledOnce()
    expect(agentDraftStore.getState().acting).toBe(false)
    expect(agentDraftStore.getState().followUp).toBeUndefined()
  })

  it("offers no follow-up while the run is still live", () => {
    useAgentRunCard.mockReturnValue({ kind: "ready", run: card() })
    render(inWorkspace(<AgentRunMessageCard msg={message()} />))

    for (const name of ["continue", "retry", "start_over", "ask"])
      expect(
        screen.queryByRole("button", { name: `agent.card.${name}` })
      ).not.toBeInTheDocument()
  })

  it("offers nothing to do outside a workspace", () => {
    useAgentRunCard.mockReturnValue({
      kind: "ready",
      run: card({ status: "completed" })
    })
    render(<AgentRunMessageCard msg={message()} />)

    expect(screen.queryByRole("button")).not.toBeInTheDocument()
  })

  it("leads a failure with the advice its key names", () => {
    useAgentRunCard.mockReturnValue({
      kind: "ready",
      run: card({ status: "failed", error: { code: "model_unavailable" } })
    })
    render(<AgentRunMessageCard msg={message()} />)

    expect(
      screen.getByText("agent.failure.model_unavailable")
    ).toBeInTheDocument()
  })

  /**
   * Pruned, deleted with nothing else, or restored without its run: the row's
   * own text is what the terminal commit left for exactly this reader.
   */
  it("falls back to the message's text when the run is gone", () => {
    useAgentRunCard.mockReturnValue({ kind: "missing" })
    const { rerender } = render(
      <AgentRunMessageCard msg={message("Open 9 to 5.")} />
    )
    expect(screen.getByText("Open 9 to 5.")).toBeInTheDocument()

    rerender(<AgentRunMessageCard msg={message()} />)
    expect(screen.getByText("agent.card.missing")).toBeInTheDocument()
  })

  it("renders page-derived result text as text, never markup", () => {
    useAgentRunCard.mockReturnValue({
      kind: "ready",
      run: card({ status: "completed", result: "<b>bold</b> claim" })
    })
    const { container } = render(<AgentRunMessageCard msg={message()} />)

    expect(container.querySelector("b")).toBeNull()
    expect(screen.getByText("<b>bold</b> claim")).toBeInTheDocument()
  })
})
