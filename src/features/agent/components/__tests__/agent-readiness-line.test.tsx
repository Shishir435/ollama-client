import type { AgentModelReadiness } from "@ollama-client/contracts"
import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, string>) =>
      values ? `${key} ${JSON.stringify(values)}` : key
  })
}))

import { AgentReadinessLine } from "../agent-readiness-line"

const readiness = (
  status: AgentModelReadiness["status"],
  extra: Partial<AgentModelReadiness> = {}
): AgentModelReadiness => ({
  status,
  reason: "metadata",
  vision: "unknown",
  ...extra
})

describe("AgentReadinessLine", () => {
  it("shows nothing while hidden or resolving", () => {
    const { container } = render(
      <AgentReadinessLine state={{ kind: "hidden" }} />
    )
    expect(container).toBeEmptyDOMElement()
  })

  it("shows nothing for a ready, qualified model", () => {
    const { container } = render(
      <AgentReadinessLine
        state={{
          kind: "known",
          readiness: readiness("ready"),
          qualified: true
        }}
      />
    )
    expect(container).toBeEmptyDOMElement()
  })

  it("says a model that can call tools is not yet qualified", () => {
    render(
      <AgentReadinessLine
        state={{
          kind: "known",
          readiness: readiness("ready"),
          qualified: false
        }}
      />
    )
    const line = screen.getByRole("status")
    expect(line).toHaveTextContent("agent.readiness.not_qualified.title")
    expect(line).toHaveTextContent("agent.readiness.not_qualified.fix")
  })

  it("warns that unconfirmed tool calling is experimental, and how to fix it", () => {
    render(
      <AgentReadinessLine
        state={{
          kind: "known",
          readiness: readiness("experimental", { reason: "unverified" }),
          qualified: false
        }}
      />
    )
    const line = screen.getByRole("alert")
    expect(line).toHaveTextContent("agent.readiness.experimental.title")
    expect(line).toHaveTextContent("agent.readiness.experimental.fix")
  })

  it("refuses an unsupported model and names the alternatives", () => {
    render(
      <AgentReadinessLine
        state={{
          kind: "known",
          readiness: readiness("unsupported", {
            reason: "reported_unsupported",
            alternatives: ["qwen3:8b", "llama3.1"]
          }),
          qualified: false
        }}
      />
    )
    const line = screen.getByRole("alert")
    expect(line).toHaveTextContent("agent.readiness.unsupported.title")
    expect(line).toHaveTextContent("agent.readiness.unsupported.fix")
    expect(line).toHaveTextContent('"models":"qwen3:8b, llama3.1"')
  })
})
