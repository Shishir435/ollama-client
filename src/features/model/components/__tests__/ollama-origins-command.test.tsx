import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { OLLAMA_ORIGINS_COMMANDS } from "@/lib/onboarding/provider-connection"
import de from "@/locales/de/translation.json"
import en from "@/locales/en/translation.json"
import es from "@/locales/es/translation.json"
import fr from "@/locales/fr/translation.json"
import hi from "@/locales/hi/translation.json"
import itLocale from "@/locales/it/translation.json"
import ja from "@/locales/ja/translation.json"
import ru from "@/locales/ru/translation.json"
import zh from "@/locales/zh/translation.json"
import { OllamaOriginsCommand } from "../ollama-origins-command"

vi.mock("react-i18next", () => {
  const t = (key: string) => key
  return { useTranslation: () => ({ t }) }
})
vi.mock("@/features/chat/components/copy-button", () => ({
  CopyButton: () => null
}))

describe("OllamaOriginsCommand", () => {
  it("switches the command per OS and notes the app must be quit", () => {
    render(<OllamaOriginsCommand />)
    fireEvent.click(screen.getByText("onboarding.provider.origins.windows"))
    expect(screen.getByText(OLLAMA_ORIGINS_COMMANDS.windows)).toBeTruthy()
    expect(
      screen.getByText("onboarding.provider.origins.quit_first")
    ).toBeTruthy()
    fireEvent.click(screen.getByText("onboarding.provider.origins.linux"))
    expect(screen.getByText(OLLAMA_ORIGINS_COMMANDS.linux)).toBeTruthy()
    expect(
      screen.queryByText("onboarding.provider.origins.quit_first")
    ).toBeNull()
  })
})

describe("Linux systemd steps", () => {
  const locales = { de, en, es, fr, hi, it: itLocale, ja, ru, zh }

  it("has every locale put the variable under a [Service] section, then restart", () => {
    for (const [code, locale] of Object.entries(locales)) {
      const steps = locale.onboarding.provider.origins.linux_steps
      const section = steps.indexOf("[Service]")
      const variable = steps.indexOf(
        'Environment="OLLAMA_ORIGINS=chrome-extension://*,moz-extension://*"'
      )
      expect(section, code).toBeGreaterThanOrEqual(0)
      expect(variable, code).toBeGreaterThan(section)
      expect(
        steps.indexOf("sudo systemctl restart ollama"),
        code
      ).toBeGreaterThan(variable)
    }
  })

  it("has every locale point at an EnvironmentFile that may set the variable", () => {
    for (const [code, locale] of Object.entries(locales)) {
      expect(locale.onboarding.provider.origins.linux_steps, code).toContain(
        "EnvironmentFile"
      )
    }
  })
})
