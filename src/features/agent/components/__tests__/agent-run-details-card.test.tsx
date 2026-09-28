import type { AgentRunState } from "@ollama-client/contracts"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const tabs = vi.hoisted(() => ({
  get: vi.fn(async (_tabId: number) => ({ url: "https://www.google.com/" })),
  update: vi.fn(async (tabId: number) => ({ id: tabId, windowId: 3 })),
  focus: vi.fn(async () => undefined)
}))

vi.mock("@/lib/browser-api", () => ({
  browser: {
    tabs: { get: tabs.get, update: tabs.update },
    windows: { update: tabs.focus }
  }
}))

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

import { AgentRunDetailsCard } from "../agent-run-details-card"

const run: AgentRunState = {
  version: 1,
  id: "agent-1",
  goal: "Search",
  status: "executing",
  stepCount: 1,
  observationCount: 1,
  controlledTabId: 7,
  providerId: "ollama",
  modelId: "qwen3",
  allowedOrigins: ["https://www.google.com"],
  createdAt: 1,
  updatedAt: 2
}

beforeEach(() => {
  tabs.get.mockClear()
  tabs.update.mockClear()
  tabs.focus.mockClear()
})

describe("the run's details card", () => {
  /**
   * The agent works in a background tab and never brings it forward, so a
   * handover or a page to review needs one click to reach it.
   */
  it("brings the run's tab and its window forward on the user's click", async () => {
    render(
      <AgentRunDetailsCard
        run={run}
        tab={{ title: "Google", url: "https://www.google.com/" }}
      />
    )

    fireEvent.click(screen.getByRole("button", { name: /agent\.tab\.show/ }))

    await waitFor(() =>
      expect(tabs.focus).toHaveBeenCalledWith(3, { focused: true })
    )
    expect(tabs.update).toHaveBeenCalledWith(7, { active: true })
  })

  /**
   * The tab is checked at the click, not when the card rendered: it may have
   * left the run's sites since, and must not be brought forward then.
   */
  it("leaves a tab that has left the run's sites where it is", async () => {
    tabs.get.mockResolvedValueOnce({ url: "https://bank.example/" })
    render(
      <AgentRunDetailsCard
        run={run}
        tab={{ title: "Google", url: "https://www.google.com/" }}
      />
    )

    fireEvent.click(screen.getByRole("button", { name: /agent\.tab\.show/ }))

    await waitFor(() => expect(tabs.get).toHaveBeenCalledWith(7))
    expect(tabs.update).not.toHaveBeenCalled()
    expect(tabs.focus).not.toHaveBeenCalled()
  })

  it("offers nothing to click when there is no tab to show", () => {
    render(<AgentRunDetailsCard run={run} />)

    expect(screen.queryByRole("button")).toBeNull()
    expect(screen.getByText("agent.tab.missing")).toBeTruthy()
  })
})
