import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { SettingsSearch } from "../settings-search"

// t returns the key so we can assert on label keys directly.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

describe("SettingsSearch", () => {
  it("shows registry matches as the user types", () => {
    render(<SettingsSearch onSelect={() => {}} />)
    const input = screen.getByRole("combobox")
    fireEvent.change(input, { target: { value: "tool result" } })
    expect(
      screen.getByText("settings.prompt_context_limits.max_tool_result_chars")
    ).toBeInTheDocument()
  })

  it("calls onSelect with the chosen entry and clears the query", () => {
    const onSelect = vi.fn()
    render(<SettingsSearch onSelect={onSelect} />)
    const input = screen.getByRole("combobox") as HTMLInputElement
    fireEvent.change(input, { target: { value: "grounded only" } })
    fireEvent.mouseDown(screen.getByText("settings.grounding_mode.label"))
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ id: "grounded-only-mode", tab: "context" })
    )
    expect(input.value).toBe("")
  })

  it("selects the first result on Enter", () => {
    const onSelect = vi.fn()
    render(<SettingsSearch onSelect={onSelect} />)
    const input = screen.getByRole("combobox")
    fireEvent.change(input, { target: { value: "selection actions" } })
    fireEvent.keyDown(input, { key: "Enter" })
    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onSelect.mock.calls[0][0].tab).toBe("contentExtraction")
  })

  it("shows nothing for an empty query", () => {
    render(<SettingsSearch onSelect={() => {}} />)
    expect(screen.queryByRole("list")).toBeNull()
  })
})
