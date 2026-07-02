import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { WebSearchToggle } from "../components/web-search-toggle"

const updateConfig = vi.fn()
const setActive = vi.fn()
let enabled = false
let active = true
let toolCalling = true

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
  }),
  useWebSearchActive: () => ({ active, setActive })
}))

vi.mock("@/features/model/hooks/use-selected-model-capabilities", () => ({
  useSelectedModelCapabilities: () => ({
    capabilities: { toolCalling },
    isResolving: false
  })
}))

describe("WebSearchToggle", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    enabled = true
    active = true
    toolCalling = true
  })

  it("renders nothing when web search is not configured in settings", () => {
    enabled = false

    const { container } = render(<WebSearchToggle />)

    expect(container).toBeEmptyDOMElement()
  })

  it("toggles the per-device active flag, never the settings enable", () => {
    render(<WebSearchToggle />)

    fireEvent.click(
      screen.getByRole("button", {
        name: "chat.input.web_search_toggle_tooltip"
      })
    )

    expect(setActive).toHaveBeenCalledWith(false)
    expect(updateConfig).not.toHaveBeenCalled()
  })

  it("reflects active state", () => {
    render(<WebSearchToggle />)

    expect(
      screen.getByRole("button", {
        name: "chat.input.web_search_toggle_tooltip"
      })
    ).toHaveAttribute("aria-pressed", "true")
  })

  it("shows a disabled toggle with an explanation when the model can't tool-call", () => {
    toolCalling = false

    render(<WebSearchToggle />)

    const toggle = screen.getByRole("button", {
      name: "chat.input.web_search_requires_tools"
    })
    expect(toggle).toBeDisabled()
    expect(toggle).toHaveAttribute("aria-pressed", "false")
  })
})
