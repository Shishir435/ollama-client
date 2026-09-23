import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values ? `${key}:${JSON.stringify(values)}` : key
  })
}))

import { AgentGoalComposer } from "../agent-goal-composer"

const composer = (
  props: Partial<Parameters<typeof AgentGoalComposer>[0]> = {}
) =>
  render(
    <AgentGoalComposer
      startable
      goal=""
      canStart={false}
      onGoalChange={vi.fn()}
      onStart={vi.fn()}
      {...props}
    />
  )

describe("AgentGoalComposer follow-up", () => {
  it("names the run the next Start continues, and asks what comes next", () => {
    composer({
      followUp: { mode: "continue", parentGoal: "Find the <b>blue</b> mug" }
    })

    expect(
      screen.getByText(
        'agent.follow_up.continue:{"goal":"Find the <b>blue</b> mug"}'
      )
    ).toBeInTheDocument()
    expect(screen.getByRole("textbox")).toHaveAttribute(
      "placeholder",
      "agent.follow_up.placeholder"
    )
  })

  it("lets the user drop it and start fresh instead", () => {
    const clear = vi.fn()
    composer({
      followUp: { mode: "retry", parentGoal: "Post the review" },
      onClearFollowUp: clear
    })

    fireEvent.click(
      screen.getByRole("button", { name: "agent.follow_up.clear" })
    )
    expect(clear).toHaveBeenCalledOnce()
  })

  it("says nothing when the run follows nothing", () => {
    composer()

    expect(screen.queryByText(/agent\.follow_up\./)).not.toBeInTheDocument()
    expect(screen.getByRole("textbox")).toHaveAttribute(
      "placeholder",
      "agent.start.placeholder"
    )
  })
})
