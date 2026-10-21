import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { PanelThinking } from "../panel-thinking"

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock("../panel-markdown", () => ({
  PanelMarkdown: ({ content }: { content: string }) => <div>{content}</div>
}))

describe("PanelThinking", () => {
  it("stays collapsed while thinking text streams", () => {
    const { rerender } = render(
      <PanelThinking isThinking thinkingText="first chunk" />
    )
    const toggle = screen.getByRole("button", {
      name: "selection_button.panel.reasoning_active"
    })

    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute("aria-expanded", "false")

    rerender(<PanelThinking isThinking thinkingText="next chunk" />)
    expect(toggle).toHaveAttribute("aria-expanded", "false")
  })
})
