import type { AgentPanelSnapshot } from "@ollama-client/contracts"
import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock("@/components/settings-button", () => ({
  SettingsButton: () => null
}))

vi.mock("@/features/model/components/model-menu", () => ({
  ModelMenu: () => null
}))

vi.mock("@/features/model/components/reasoning-effort-menu", () => ({
  ReasoningEffortMenu: () => null
}))

vi.mock("@/lib/browser-api", () => ({
  openOptionsInTab: vi.fn(),
  runtime: { getURL: (path: string) => path }
}))

vi.mock("@/lib/exporters/utils", () => ({ downloadFile: vi.fn() }))

vi.mock("@/hooks/use-setting", () => ({
  useSetting: () => [true, vi.fn()]
}))

let selected = { selectedModel: "qwen3", selectedProviderId: "ollama" }

/*
 * Mocked rather than mounted: the real store loads the session list from
 * SQLite on first read, which this test has no owner for and no opinion about.
 */
vi.mock("@/features/sessions/stores/chat-session-store", () => ({
  useChatSessions: () => ({ currentSessionId: "s-1" })
}))

vi.mock("@/features/model/hooks/use-provider-models", () => ({
  useProviderModels: () => selected
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

vi.mock("../stores/agent-draft-store", () => ({
  useAgentDraft: () => ({
    goal: "Close this issue",
    setGoal: vi.fn(),
    completeGoal: vi.fn(),
    clearFollowUp: vi.fn(),
    settleFollowUp: vi.fn()
  })
}))

const runInputs: { allowExperimentalModel?: boolean }[] = []

const snapshot: AgentPanelSnapshot = {
  steps: [],
  provider: {
    name: "Local",
    model: "qwen3",
    location: "local",
    readiness: {
      status: "experimental",
      reason: "user_override",
      vision: "unknown"
    }
  }
}

vi.mock("../hooks/use-agent-run", () => ({
  useAgentRun: (input: { allowExperimentalModel?: boolean }) => {
    runInputs.push(input)
    return {
      snapshot,
      busy: false,
      failure: undefined,
      debugReport: undefined,
      start: vi.fn(),
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
    }
  }
}))

const { AgentPanel } = await import("../agent-panel")

const latest = () => runInputs[runInputs.length - 1]?.allowExperimentalModel

/** The readiness card's own checkbox, not the routine-actions consent beside it. */
const optIn = (): HTMLElement => {
  const label = screen
    .getByText("agent.readiness.allow_experimental")
    .closest("label")
  const checkbox = label?.querySelector("input[type=checkbox]")
  if (!(checkbox instanceof HTMLElement)) {
    throw new Error("The experimental opt-in checkbox is not rendered")
  }
  return checkbox
}

beforeEach(() => {
  runInputs.length = 0
  selected = { selectedModel: "qwen3", selectedProviderId: "ollama" }
})

describe("AgentPanel experimental opt-in", () => {
  it("does not carry a confirmation to the next model", () => {
    /*
     * The panel stays mounted across a model switch, so a yes given for one
     * experimental model started the next one without anyone confirming that
     * one — with tool calling on by the user's override either way.
     */
    const { rerender } = render(<AgentPanel />)
    expect(latest()).toBe(false)

    fireEvent.click(optIn())
    expect(latest()).toBe(true)

    selected = { selectedModel: "gemma", selectedProviderId: "ollama" }
    rerender(<AgentPanel />)
    expect(latest()).toBe(false)
  })

  it("keeps the confirmation while the same model stays selected", () => {
    const { rerender } = render(<AgentPanel />)
    fireEvent.click(optIn())

    rerender(<AgentPanel />)
    expect(latest()).toBe(true)
  })
})
