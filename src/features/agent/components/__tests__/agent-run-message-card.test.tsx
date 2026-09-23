import type { AgentRunCard } from "@ollama-client/contracts/agent-rpc"
import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { ChatMessage } from "@/types"
import { AgentSurfaceLauncherContext } from "../../lib/agent-surface-launcher"

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

  it("shows a live run's status and offers the Agent surface", () => {
    useAgentRunCard.mockReturnValue({ kind: "ready", run: card() })
    const open = vi.fn()
    render(
      <AgentSurfaceLauncherContext.Provider value={open}>
        <AgentRunMessageCard msg={message()} />
      </AgentSurfaceLauncherContext.Provider>
    )

    expect(screen.getByText("agent.status.executing")).toBeInTheDocument()
    expect(screen.getByText('agent.card.steps:{"count":3}')).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "agent.card.open" }))
    expect(open).toHaveBeenCalledTimes(1)
  })

  it("says so when a run is waiting on the user", () => {
    useAgentRunCard.mockReturnValue({
      kind: "ready",
      run: card({ status: "awaiting_approval" })
    })
    render(
      <AgentSurfaceLauncherContext.Provider value={vi.fn()}>
        <AgentRunMessageCard msg={message()} />
      </AgentSurfaceLauncherContext.Provider>
    )

    expect(
      screen.getByRole("button", { name: "agent.card.needs_you" })
    ).toBeInTheDocument()
  })

  it("offers no way out where the shell has no Agent surface", () => {
    useAgentRunCard.mockReturnValue({ kind: "ready", run: card() })
    render(<AgentRunMessageCard msg={message()} />)

    expect(screen.queryByRole("button")).not.toBeInTheDocument()
  })

  it("shows a settled run's result and outcome, with nothing to open", () => {
    useAgentRunCard.mockReturnValue({
      kind: "ready",
      run: card({
        status: "partial",
        result: "Open 9 to 5 on weekdays.",
        outcome: { met: 1, total: 2 }
      })
    })
    render(
      <AgentSurfaceLauncherContext.Provider value={vi.fn()}>
        <AgentRunMessageCard msg={message()} />
      </AgentSurfaceLauncherContext.Provider>
    )

    expect(screen.getByText("Open 9 to 5 on weekdays.")).toBeInTheDocument()
    expect(
      screen.getByText(/agent\.card\.outcome:\{"met":1,"total":2\}/)
    ).toBeInTheDocument()
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
