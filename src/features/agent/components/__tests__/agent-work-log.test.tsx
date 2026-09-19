import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { AgentWorkLog } from "../agent-work-log"

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values ? `${key}:${JSON.stringify(values)}` : key
  })
}))

const item = (overrides = {}) => ({
  id: "step-1",
  at: 1,
  label: { key: "agent.action.click" },
  status: "verified" as const,
  target: "Reply",
  detail: "Page changed",
  ...overrides
})

describe("AgentWorkLog", () => {
  it("keeps one compact chain row per durable step", () => {
    const { container } = render(
      <AgentWorkLog items={[item(), item({ id: "step-2" })]} />
    )

    expect(screen.getAllByRole("listitem")).toHaveLength(2)
    expect(container.querySelectorAll("details")).toHaveLength(2)
    expect(container.querySelector("details")).not.toHaveAttribute("open")
  })

  it("reveals step evidence on demand", () => {
    const { container } = render(<AgentWorkLog items={[item()]} />)
    const disclosure = container.querySelector("details")

    expect(disclosure).not.toHaveAttribute("open")

    fireEvent.click(screen.getByText("agent.action.click"))

    expect(disclosure).toHaveAttribute("open")
    expect(screen.getByText("Page changed")).toBeInTheDocument()
  })

  it("opens active and attention-needed steps", () => {
    const { container } = render(
      <AgentWorkLog
        items={[
          item({ id: "active", status: "executing" }),
          item({ id: "review", status: "uncertain" })
        ]}
      />
    )

    expect(container.querySelectorAll("details[open]")).toHaveLength(2)
  })

  it("keeps a user-collapsed row closed across rerenders", () => {
    const running = item({ id: "active", status: "executing" })
    const { container, rerender } = render(<AgentWorkLog items={[running]} />)

    expect(container.querySelector("details")).toHaveAttribute("open")

    fireEvent.click(screen.getByText("agent.action.click"))

    expect(container.querySelector("details")).not.toHaveAttribute("open")

    rerender(<AgentWorkLog items={[running]} />)

    expect(container.querySelector("details")).not.toHaveAttribute("open")
  })

  it("reopens a row whose status moves to attention-needed", () => {
    const running = item({ id: "active", status: "executing" })
    const { container, rerender } = render(<AgentWorkLog items={[running]} />)

    fireEvent.click(screen.getByText("agent.action.click"))

    expect(container.querySelector("details")).not.toHaveAttribute("open")

    rerender(
      <AgentWorkLog
        items={[{ ...running, status: "failed" as const, detail: "Nope" }]}
      />
    )

    expect(container.querySelector("details")).toHaveAttribute("open")
  })

  it("keeps rows without evidence compact and preserves their controls", () => {
    const controls = <button type="button">Resume</button>
    const { container } = render(
      <AgentWorkLog
        items={[
          item({
            status: "executing",
            target: undefined,
            detail: undefined
          })
        ]}
        controls={controls}
      />
    )

    expect(container.querySelector("details")).toBeNull()
    expect(screen.getByRole("button", { name: "Resume" })).toBeInTheDocument()
  })
})
