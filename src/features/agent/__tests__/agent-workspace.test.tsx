import type {
  AgentPanelSnapshot,
  AgentRunState
} from "@ollama-client/contracts"
import { render, screen } from "@testing-library/react"
import { useContext } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const sessions = vi.hoisted(() => ({
  currentSessionId: "s-1" as string | null,
  loadSessionMessages: vi.fn(async () => undefined)
}))
vi.mock("@/features/sessions/stores/chat-session-store", () => ({
  chatSessionStore: { getState: () => sessions }
}))

vi.mock("../hooks/use-agent-debug-report", () => ({
  useAgentDebugReport: () => undefined
}))

const port = vi.hoisted(() => ({
  snapshot: { steps: [] } as AgentPanelSnapshot
}))
vi.mock("../hooks/use-agent-run", () => ({
  useAgentRun: () => ({
    snapshot: port.snapshot,
    failure: undefined,
    busy: false,
    debugReport: undefined
  })
}))

import { AgentWorkspace } from "../agent-workspace"
import { AgentConnectionContext } from "../lib/agent-connection"

const run = (patch: Partial<AgentRunState> = {}): AgentRunState => ({
  version: 1,
  id: "run-1",
  goal: "Find the pricing page",
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

/** What a card below the workspace would read. */
const Probe = () => {
  const workspace = useContext(AgentConnectionContext)
  return (
    <p>
      run:{workspace?.connection.snapshot.run?.id ?? "none"} tab:
      {workspace?.tab?.title ?? "none"}
    </p>
  )
}

describe("AgentWorkspace", () => {
  beforeEach(() => {
    port.snapshot = { steps: [] }
    sessions.currentSessionId = "s-1"
    sessions.loadSessionMessages.mockClear()
  })

  it("lends the conversation its one supervision port", () => {
    port.snapshot = {
      steps: [],
      run: run(),
      tab: { title: "Example", url: "https://example.com" }
    }
    render(
      <AgentWorkspace>
        <Probe />
      </AgentWorkspace>
    )

    expect(screen.getByText("run:run-1 tab:Example")).toBeInTheDocument()
  })

  /**
   * The row a run reports into was written by the background, so the chat on
   * screen does not know it carries a run until it is read again.
   */
  it("re-reads the chat once when a run it has not shown appears", () => {
    const view = render(
      <AgentWorkspace>
        <Probe />
      </AgentWorkspace>
    )
    expect(sessions.loadSessionMessages).not.toHaveBeenCalled()

    port.snapshot = { steps: [], run: run() }
    view.rerender(
      <AgentWorkspace>
        <Probe />
      </AgentWorkspace>
    )
    view.rerender(
      <AgentWorkspace>
        <Probe />
      </AgentWorkspace>
    )

    expect(sessions.loadSessionMessages).toHaveBeenCalledTimes(1)
    expect(sessions.loadSessionMessages).toHaveBeenCalledWith("s-1")
  })

  it("names no tab for a run that has settled", () => {
    port.snapshot = {
      steps: [],
      run: run({ status: "completed" }),
      tab: { title: "Example", url: "https://example.com" }
    }
    render(
      <AgentWorkspace>
        <Probe />
      </AgentWorkspace>
    )

    expect(screen.getByText("run:run-1 tab:none")).toBeInTheDocument()
  })
})
