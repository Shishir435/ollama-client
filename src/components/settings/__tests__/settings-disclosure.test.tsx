import { fireEvent, render, screen } from "@testing-library/react"
import { useState } from "react"
import { describe, expect, it, vi } from "vitest"

import {
  SettingsDisclosureControl,
  SettingsDisclosureProvider,
  SettingsLevelGate
} from "../settings-disclosure"

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key })
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

    const advancedTab = screen.getByRole("tab", {
      name: "settings.disclosure.levels.advanced"
    })

    expect(advancedTab).toHaveAttribute("aria-selected", "false")
    expect(screen.queryByText("advanced content")).toBeNull()

    fireEvent.click(advancedTab)

    expect(onLevelChange).toHaveBeenCalledWith("advanced")
    expect(advancedTab).toHaveAttribute("aria-selected", "true")
    expect(screen.getByText("advanced content")).toBeInTheDocument()
  })
})
