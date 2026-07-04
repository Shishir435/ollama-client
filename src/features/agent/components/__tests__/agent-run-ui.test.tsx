import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { AgentRunHeader } from "../agent-run-header"
import { AgentRunTimeline } from "../agent-run-timeline"

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number }) =>
      key === "agent.header.steps"
        ? `${options?.count ?? 0} steps`
        : key.replace(
            /^agent\.(?:header|actions|status|timeline|step_status)\./,
            ""
          )
  })
}))

const pausedRun = {
  id: "run-1",
  sessionId: "session-1",
  status: "paused" as const,
  state: {
    task: "Update profile",
    targetTabId: 7,
    targetUrl: "https://example.com/profile",
    allowedOrigins: ["https://example.com"],
    steps: [
      {
        id: "step-1",
        kind: "observe" as const,
        label: "Observed page",
        status: "done" as const,
        startedAt: 1,
        completedAt: 5,
        result: "Found profile form"
      }
    ],
    modelTurns: 1,
    actionCount: 0,
    activeMs: 65_000
  },
  createdAt: 1,
  updatedAt: 2
}

describe("agent run UI", () => {
  it("shows durable status and exposes resume, stop, and export", () => {
    const onResume = vi.fn()
    const onStop = vi.fn()
    const onExport = vi.fn()

    render(
      <AgentRunHeader
        enabled
        run={pausedRun}
        onEnabledChange={vi.fn()}
        onPause={vi.fn()}
        onResume={onResume}
        onStop={onStop}
        onExport={onExport}
      />
    )

    expect(screen.getByText("paused")).toBeInTheDocument()
    expect(screen.getByText("https://example.com")).toBeInTheDocument()
    expect(screen.getByText("1:05")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: /resume/i }))
    fireEvent.click(screen.getByRole("button", { name: /stop/i }))
    fireEvent.click(screen.getByRole("button", { name: /export/i }))
    expect(onResume).toHaveBeenCalled()
    expect(onStop).toHaveBeenCalled()
    expect(onExport).toHaveBeenCalled()
  })

  it("collapses completed steps and keeps active steps expanded", () => {
    render(
      <AgentRunTimeline
        steps={[
          pausedRun.state.steps[0],
          {
            id: "step-2",
            kind: "act",
            label: "Click Save",
            status: "running",
            startedAt: 10,
            result: "Waiting"
          }
        ]}
      />
    )

    expect(screen.queryByText("Found profile form")).not.toBeInTheDocument()
    expect(screen.getByText("Waiting")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: /Observed page/i }))
    expect(screen.getByText("Found profile form")).toBeInTheDocument()
  })
})
