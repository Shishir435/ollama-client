import type { AgentModelReadiness } from "@ollama-client/contracts"
import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

const selectedRef = vi.hoisted(() => ({
  current: { providerId: "p", modelId: "one" } as {
    providerId: string
    modelId: string
  } | null
}))

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, string>) =>
      values ? `${key} ${JSON.stringify(values)}` : key
  })
}))

vi.mock("@/hooks/use-setting", () => ({
  useSetting: () => [selectedRef.current]
}))
vi.mock("../../hooks/use-agent-readiness", () => ({
  useAgentReadiness: () => ({
    kind: "known",
    readiness: {
      status: "experimental",
      reason: "metadata",
      vision: "unknown"
    },
    qualified: false
  })
}))

import {
  AgentReadinessLine,
  SelectedModelAgentReadiness
} from "../agent-readiness-line"

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
    const line = screen.getByRole("status")
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
    const line = screen.getByRole("status")
    expect(line).toHaveTextContent("agent.readiness.unsupported.title")
    expect(line).toHaveTextContent("agent.readiness.unsupported.fix")
    expect(line).toHaveTextContent('"models":"qwen3:8b, llama3.1"')
  })
})

describe("AgentReadinessLine disclosure", () => {
  const notQualified = {
    kind: "known" as const,
    readiness: readiness("ready"),
    qualified: false
  }

  it("expands and collapses the explanation in place", () => {
    render(<AgentReadinessLine state={notQualified} />)
    const button = screen.getByRole("button", {
      name: "agent.readiness.show_details"
    })
    const text = document.getElementById(
      button.getAttribute("aria-controls") as string
    ) as HTMLElement
    expect(button).toHaveAttribute("aria-expanded", "false")
    expect(text).toHaveClass("truncate")

    fireEvent.click(button)
    const hide = screen.getByRole("button", {
      name: "agent.readiness.hide_details"
    })
    expect(hide).toHaveAttribute("aria-expanded", "true")
    expect(text).not.toHaveClass("truncate")

    fireEvent.click(hide)
    expect(
      screen.getByRole("button", { name: "agent.readiness.show_details" })
    ).toHaveAttribute("aria-expanded", "false")
    expect(text).toHaveClass("truncate")
  })

  it("starts collapsed again when the selected model changes", () => {
    selectedRef.current = { providerId: "p", modelId: "one" }
    const { rerender } = render(<SelectedModelAgentReadiness />)
    fireEvent.click(
      screen.getByRole("button", { name: "agent.readiness.show_details" })
    )
    expect(
      screen.getByRole("button", { name: "agent.readiness.hide_details" })
    ).toBeInTheDocument()
    selectedRef.current = { providerId: "p", modelId: "two" }
    rerender(<SelectedModelAgentReadiness />)
    expect(
      screen.getByRole("button", { name: "agent.readiness.show_details" })
    ).toHaveAttribute("aria-expanded", "false")
  })
})
