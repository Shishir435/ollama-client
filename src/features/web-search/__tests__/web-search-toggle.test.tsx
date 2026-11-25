import { fireEvent, render, screen, waitFor } from "@testing-library/react"
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
    isResolving: false,
    modelRef: { providerId: "ollama", modelId: "gemma3" }
  })
}))

const overrides = vi.hoisted(() => ({
  get: vi.fn(),
  listeners: new Set<(kind: string) => void>()
}))
vi.mock("@/lib/tools/tool-model-overrides", () => ({
  getToolModelOverride: overrides.get
}))
vi.mock("@/lib/repositories/model-preferences", () => ({
  subscribeModelPreferences: (listener: (kind: string) => void) => {
    overrides.listeners.add(listener)
    return () => overrides.listeners.delete(listener)
  }
}))

const openSettingsFocus = vi.hoisted(() => vi.fn())
vi.mock("@/features/settings/open-settings-focus", () => ({
  openSettingsFocus
}))

describe("WebSearchToggle", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    enabled = true
    active = true
    toolCalling = true
    overrides.get.mockResolvedValue(null)
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

  it("explains why web search is unavailable and links to the model setting", () => {
    toolCalling = false

    render(<WebSearchToggle />)

    const toggle = screen.getByRole("button", {
      name: "chat.input.web_search_requires_tools chat.input.web_search_requires_tools_open"
    })
    expect(toggle).toHaveAttribute("aria-disabled", "true")
    expect(toggle).toHaveAttribute("aria-pressed", "false")

    fireEvent.click(toggle)

    expect(openSettingsFocus).toHaveBeenCalledWith(
      "model-tools-nonnative-fallback"
    )
    expect(setActive).not.toHaveBeenCalled()
  })

  it("unblocks for a model the user opted into the tool fallback", async () => {
    toolCalling = false
    overrides.get.mockResolvedValue({ nonNativeToolFallback: true })

    render(<WebSearchToggle />)

    const toggle = await screen.findByRole("button", {
      name: "chat.input.web_search_toggle_tooltip"
    })
    expect(overrides.get).toHaveBeenCalledWith("ollama", "gemma3")
    expect(toggle).not.toHaveAttribute("aria-disabled", "true")
    fireEvent.click(toggle)
    expect(setActive).toHaveBeenCalledWith(false)
    expect(openSettingsFocus).not.toHaveBeenCalled()
  })

  it("unblocks as soon as the fallback is switched on in settings", async () => {
    toolCalling = false
    render(<WebSearchToggle />)
    await waitFor(() => expect(overrides.get).toHaveBeenCalled())
    expect(
      screen.getByRole("button", {
        name: "chat.input.web_search_requires_tools chat.input.web_search_requires_tools_open"
      })
    ).toBeInTheDocument()

    overrides.get.mockResolvedValue({ nonNativeToolFallback: true })
    for (const listener of overrides.listeners) listener("tools")

    expect(
      await screen.findByRole("button", {
        name: "chat.input.web_search_toggle_tooltip"
      })
    ).toBeInTheDocument()
  })
})
