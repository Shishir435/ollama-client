import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { SettingsButton } from "@/components/settings-button"
import { ThemeToggle } from "@/components/theme-toggle"
import { TooltipProvider } from "@/components/ui/tooltip"

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: { theme?: string }) =>
      key === "common.theme.current_aria_label"
        ? `${values?.theme}, toggle theme`
        : ((
            {
              "common.settings.label": "Settings",
              "common.settings.aria_label": "Extension Settings",
              "common.settings.tooltip": "Extension Settings",
              "common.theme.system": "System",
              "common.theme.toggle": "Toggle Theme",
              "common.theme.toggle_aria_label": "Toggle theme"
            } as Record<string, string>
          )[key] ?? key)
  })
}))

vi.mock("@/lib/browser-api", () => ({ openOptionsInTab: vi.fn() }))

const renderIn = (node: React.ReactNode) =>
  render(<TooltipProvider>{node}</TooltipProvider>)

describe("buttons that show their label", () => {
  it("names the settings button by its visible text", () => {
    renderIn(<SettingsButton />)
    expect(screen.getByRole("button", { name: "Settings" })).toBeInTheDocument()
  })

  it("keeps the longer name when the settings label is hidden", () => {
    renderIn(<SettingsButton showText={false} />)
    expect(
      screen.getByRole("button", { name: "Extension Settings" })
    ).toBeInTheDocument()
  })

  it("starts the theme button's name with the theme it shows", () => {
    renderIn(<ThemeToggle />)
    const button = screen.getByRole("button", { name: "System, toggle theme" })
    expect(button).toHaveTextContent("System")
  })

  it("keeps the plain name when the theme label is hidden", () => {
    renderIn(<ThemeToggle showText={false} />)
    expect(
      screen.getByRole("button", { name: "Toggle theme" })
    ).toBeInTheDocument()
  })
})
