import { fireEvent, render, screen } from "@testing-library/react"
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

  it("emits the selected level", () => {
    const onLevelChange = vi.fn()
    render(
      <SettingsDisclosureControl level="basic" onLevelChange={onLevelChange} />
    )

    fireEvent.click(
      screen.getByRole("button", {
        name: "settings.disclosure.levels.advanced"
      })
    )

    expect(onLevelChange).toHaveBeenCalledWith("advanced")
  })
})
