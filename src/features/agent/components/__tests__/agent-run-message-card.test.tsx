import type { AgentRunState } from "@ollama-client/contracts"
import type { AgentRunCard } from "@ollama-client/contracts/agent-rpc"
import { fireEvent, render, screen } from "@testing-library/react"
import type { ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { ChatMessage } from "@/types"
import type { AgentRunConnection } from "../../hooks/use-agent-run"
import { AgentChatComposerContext } from "../../lib/agent-chat-composer"
import { AgentConnectionContext } from "../../lib/agent-connection"

const useAgentRunCard = vi.hoisted(() => vi.fn())

vi.mock("../../hooks/use-agent-run-card", () => ({ useAgentRunCard }))
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values ? `${key}:${JSON.stringify(values)}` : key,
    i18n: { language: "en" }
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

/** The card as the side panel mounts it: a workspace port and chat's door. */
const inWorkspace = (
  children: ReactNode,
  port: AgentRunConnection = connection(),
  draft: (text?: string) => void = vi.fn()
) => (
  <AgentConnectionContext.Provider value={{ connection: port }}>
    <AgentChatComposerContext.Provider value={draft}>
      {children}
    </AgentChatComposerContext.Provider>
  </AgentConnectionContext.Provider>
)

beforeEach(() => {
  useAgentRunCard.mockReset()
})

describe("AgentRunMessageCard", () => {
  it("reads the run its message names", () => {
    useAgentRunCard.mockReturnValue({ kind: "loading" })
    render(<AgentRunMessageCard msg={message()} />)

    expect(useAgentRunCard).toHaveBeenCalledWith("run-1")
    expect(screen.getByText("agent.card.loading")).toBeInTheDocument()
  })

  it("shows a run's status read from its row", () => {
    useAgentRunCard.mockReturnValue({ kind: "ready", run: card() })
    render(<AgentRunMessageCard msg={message()} />)

    expect(screen.getByText("agent.status.executing")).toBeInTheDocument()
  })

  /**
   * The count is the rows' own, so it cannot say "Actions: 1" under a log
   * that showed two, and the rows survive the run settling.
   */
  it("keeps a settled run's steps behind a count of them", () => {
    useAgentRunCard.mockReturnValue({
      kind: "ready",
      run: card({
        status: "completed",
        stepCount: 1,
        pages: 2,
        steps: [
          {
            runId: "run-1",
            stepId: "run-1:1",
            sequence: 1,
            status: "verified",
            at: 5_000,
            startedAt: 2_000,
            command: {
              type: "click",
              ref: "e1",
              snapshotId: "s",
              generation: 1
            },
            target: { name: "Delete", rowContext: "old.pdf Delete" }
          },
          {
            runId: "run-1",
            stepId: "run-1:refused:2",
            sequence: 2,
            status: "rejected",
            at: 6_000
          }
        ]
      })
    })
    render(<AgentRunMessageCard msg={message()} />)

    expect(
      screen.getByText(/agent\.card\.step_count:\{"count":2\}/)
    ).toBeInTheDocument()
    expect(
      screen.getByText(/agent\.card\.page_count:\{"count":2\}/)
    ).toBeInTheDocument()
    expect(screen.getByText(/old\.pdf/)).toBeInTheDocument()
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

  /**
   * The model's answer under the card already says what the run found; the
   * card repeats the result only when there is no answer to read.
   */
  it("leaves the result to the answer when the turn wrote one", () => {
    useAgentRunCard.mockReturnValue({
      kind: "ready",
      run: card({ status: "completed", result: "Open 9 to 5 on weekdays." })
    })
    render(
      inWorkspace(<AgentRunMessageCard msg={message("They open at nine.")} />)
    )

    expect(
      screen.queryByText("Open 9 to 5 on weekdays.")
    ).not.toBeInTheDocument()
  })

  /**
   * Every follow-up is a message the user still sends, and the model decides
   * whether the browser is needed; the card only drafts it.
   */
  it("continues a run that got somewhere by drafting a message", () => {
    useAgentRunCard.mockReturnValue({
      kind: "ready",
      run: card({ status: "completed" })
    })
    const draft = vi.fn()
    render(
      inWorkspace(<AgentRunMessageCard msg={message()} />, undefined, draft)
    )

    expect(
      screen.queryByRole("button", { name: "agent.card.retry" })
    ).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "agent.card.continue" }))

    expect(draft).toHaveBeenCalledWith(
      "agent.follow_up.continue_message",
      "run-1"
    )
  })

  it("retries a run that stopped short by drafting a message", () => {
    useAgentRunCard.mockReturnValue({
      kind: "ready",
      run: card({
        status: "failed",
        error: { code: "goal_failed" }
      })
    })
    const draft = vi.fn()
    render(
      inWorkspace(<AgentRunMessageCard msg={message()} />, undefined, draft)
    )

    fireEvent.click(screen.getByRole("button", { name: "agent.card.retry" }))

    expect(draft).toHaveBeenCalledWith("agent.follow_up.retry_message", "run-1")
  })

  it("starts over by restating the goal", () => {
    useAgentRunCard.mockReturnValue({
      kind: "ready",
      run: card({ status: "cancelled" })
    })
    const draft = vi.fn()
    render(
      inWorkspace(<AgentRunMessageCard msg={message()} />, undefined, draft)
    )

    fireEvent.click(
      screen.getByRole("button", { name: "agent.card.start_over" })
    )

    expect(draft).toHaveBeenCalledWith("Find the opening hours")
  })

  it("asks about a settled run by handing the caret to the composer", () => {
    useAgentRunCard.mockReturnValue({
      kind: "ready",
      run: card({ status: "completed" })
    })
    const draft = vi.fn()
    render(
      inWorkspace(<AgentRunMessageCard msg={message()} />, undefined, draft)
    )

    fireEvent.click(screen.getByRole("button", { name: "agent.card.ask" }))

    expect(draft).toHaveBeenCalledWith()
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
   * own text is drawn by chat under the card, so the card says the run is
   * gone only when there is no text to read instead.
   */
  it("says the run is gone only when the row has no text", () => {
    useAgentRunCard.mockReturnValue({ kind: "missing" })
    const { rerender } = render(
      <AgentRunMessageCard msg={message("Open 9 to 5.")} />
    )
    expect(screen.queryByText("agent.card.missing")).not.toBeInTheDocument()

    rerender(<AgentRunMessageCard msg={message()} />)
    expect(screen.getByText("agent.card.missing")).toBeInTheDocument()
  })

  /**
   * The result is the model's answer, drawn as chat draws one — through the
   * same renderer and its sanitizer — so a list stays a list.
   */
  it("renders the result as markdown", () => {
    useAgentRunCard.mockReturnValue({
      kind: "ready",
      run: card({
        status: "completed",
        result: "Found:\n\n- first\n- second"
      })
    })
    const { container } = render(<AgentRunMessageCard msg={message()} />)

    expect(container.querySelector(".markdown-container")).not.toBeNull()
    expect(container.querySelectorAll("li")).toHaveLength(2)
  })
})
