import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { WebSearchToggle } from "../components/web-search-toggle"

const updateConfig = vi.fn()
let enabled = false

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

vi.mock("../stores/web-search-config-store", () => ({
  useWebSearchConfig: () => ({
    config: {
      provider: "searxng",
      enabled,
      count: 5,
      safeSearch: "moderate"
    },
    updateConfig
  })
}))

describe("WebSearchToggle", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    enabled = false
  })

  it("toggles web search config from the chat toolbar", () => {
    render(<WebSearchToggle />)

    fireEvent.click(
      screen.getByRole("button", {
        name: "chat.input.web_search_toggle_tooltip"
      })
    )

    expect(updateConfig).toHaveBeenCalledWith({ enabled: true })
  })

  it("reflects enabled state", () => {
    enabled = true

    render(<WebSearchToggle />)

    expect(
      screen.getByRole("button", {
        name: "chat.input.web_search_toggle_tooltip"
      })
    ).toHaveAttribute("aria-pressed", "true")
  })
})
