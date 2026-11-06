import { fireEvent, render, screen } from "@testing-library/react"
import { useState } from "react"
import { describe, expect, it, vi } from "vitest"
import {
  SettingsDisclosureControl,
  SettingsDisclosureProvider,
  SettingsLevelGate
} from "../settings-disclosure"

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values?.count === undefined ? key : `${key}:${values.count}`
  })
}))

describe("settings disclosure", () => {
  it("shows only settings available at the current level", () => {
    render(
      <SettingsDisclosureProvider level="power">
        <SettingsLevelGate level="basic">
          <span>basic content</span>
        </SettingsLevelGate>
        <SettingsLevelGate settingId="memory-enabled">
          <span>power content</span>
        </SettingsLevelGate>
        <SettingsLevelGate settingId="temperature">
          <span>advanced content</span>
        </SettingsLevelGate>
      </SettingsDisclosureProvider>
    )

    expect(screen.getByText("basic content")).toBeInTheDocument()
    expect(screen.getByText("power content")).toBeInTheDocument()
    expect(screen.queryByText("advanced content")).toBeNull()
  })

  it("changes the selected tab and visible settings", () => {
    const onLevelChange = vi.fn()

    const Harness = () => {
      const [level, setLevel] = useState<"basic" | "power" | "advanced">(
        "basic"
      )
      return (
        <SettingsDisclosureProvider level={level}>
          <SettingsDisclosureControl
            level={level}
            onLevelChange={(next) => {
              onLevelChange(next)
              setLevel(next)
            }}
          />
          <SettingsLevelGate level="advanced">
            <span>advanced content</span>
          </SettingsLevelGate>
        </SettingsDisclosureProvider>
      )
    }

    render(<Harness />)

    // The explanation is visible, not hidden behind a tooltip.
    expect(
      screen.getByText("settings.disclosure.description")
    ).toBeInTheDocument()
    expect(screen.getByText(/settings.disclosure.hidden_count:/)).toBeVisible()
    expect(screen.getByRole("tablist")).toHaveAccessibleName(
      "settings.disclosure.title"
    )

    const advancedTab = screen.getByRole("tab", {
      name: "settings.disclosure.levels.advanced"
    })

    expect(advancedTab).toHaveAttribute("aria-selected", "false")
    expect(advancedTab).toHaveClass("data-active:bg-state-selected")
    expect(advancedTab).not.toHaveClass("data-active:bg-primary")
    expect(screen.queryByText("advanced content")).toBeNull()

    fireEvent.click(advancedTab)

    expect(onLevelChange).toHaveBeenCalledWith("advanced")
    expect(advancedTab).toHaveAttribute("aria-selected", "true")
    expect(screen.getByText("advanced content")).toBeInTheDocument()
  })

  it("offers show all, which jumps to the top level and hides the count", () => {
    const onLevelChange = vi.fn()
    const { rerender } = render(
      <SettingsDisclosureControl level="basic" onLevelChange={onLevelChange} />
    )
    fireEvent.click(
      screen.getByRole("button", { name: "settings.disclosure.show_all" })
    )
    expect(onLevelChange).toHaveBeenCalledWith("advanced")

    rerender(
      <SettingsDisclosureControl
        level="advanced"
        onLevelChange={onLevelChange}
      />
    )
    expect(screen.queryByText(/settings.disclosure.hidden_count/)).toBeNull()
  })
})
