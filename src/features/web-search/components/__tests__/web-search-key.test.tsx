import { fireEvent, render, screen } from "@testing-library/react"
import { useState } from "react"
import { describe, expect, it, vi } from "vitest"
import { WebSearchSettings } from "../web-search-settings"

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }))
vi.mock("../../stores/web-search-config-store", async () => {
  const actual = await vi.importActual<object>(
    "../../stores/web-search-config-store"
  )
  return {
    ...actual,
    useWebSearchConfig: () => {
      const [config, setConfig] = useState({
        provider: "brave",
        apiKey: "saved-key"
      })
      return {
        config,
        updateConfig: (updates: object) =>
          setConfig((current) => ({ ...current, ...updates }))
      }
    }
  }
})

describe("web search API key", () => {
  it("Cancel restores the saved key instead of keeping typed text", () => {
    render(<WebSearchSettings />)
    fireEvent.click(screen.getByText("settings.secret_key.replace"))
    const input = document.getElementById(
      "web-search-api-key"
    ) as HTMLInputElement
    fireEvent.change(input, { target: { value: "typo" } })
    expect(input.value).toBe("typo")
    fireEvent.click(screen.getByText("settings.secret_key.cancel"))
    expect(screen.getByText("settings.secret_key.saved")).toBeTruthy()
    fireEvent.click(screen.getByText("settings.secret_key.replace"))
    expect(
      (document.getElementById("web-search-api-key") as HTMLInputElement).value
    ).toBe("saved-key")
  })
})
