import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { OLLAMA_ORIGINS_COMMANDS } from "@/lib/onboarding/provider-connection"
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
