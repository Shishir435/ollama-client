import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { Shield } from "@/lib/lucide-icon"
import { SettingsChangeDialog } from "../settings-change-dialog"

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) => {
      if (key === "common.toggle.on") return "On"
      if (key === "common.toggle.off") return "Off"
      if (key === "common.cancel") return "Cancel"
      return vars ? `${key} ${JSON.stringify(vars)}` : key
    }
  })
}))

describe("SettingsChangeDialog", () => {
  const writes = [
    { storageKey: "browser-tab-access", value: false },
    { storageKey: "chat-grounded-only-mode", value: true },
    { storageKey: "chat-max-tab-context-chars", value: 6000 }
  ]

  it("renders humanized rows with toggle and value controls", () => {
    render(
      <SettingsChangeDialog
        open
        onOpenChange={() => {}}
        icon={Shield}
        title="Apply Privacy"
        writes={writes}
        confirmLabel="Apply preset"
        onConfirm={() => {}}
      />
    )

    expect(screen.getByText("Tab access")).toBeInTheDocument()
    expect(screen.getByText("Grounded only mode")).toBeInTheDocument()
    expect(screen.getByText("Max tab context chars")).toBeInTheDocument()
    // boolean rows show On/Off, number rows show the raw value
    expect(screen.getByText("On")).toBeInTheDocument()
    expect(screen.getByText("Off")).toBeInTheDocument()
    expect(screen.getByText("6000")).toBeInTheDocument()
  })

  it("fires onConfirm from the apply button", () => {
    const onConfirm = vi.fn()
    render(
      <SettingsChangeDialog
        open
        onOpenChange={() => {}}
        icon={Shield}
        title="Apply Privacy"
        writes={writes}
        confirmLabel="Apply preset"
        onConfirm={onConfirm}
      />
    )
    fireEvent.click(screen.getByRole("button", { name: "Apply preset" }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })
})
