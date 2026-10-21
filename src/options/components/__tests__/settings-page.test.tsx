import {
  fireEvent,
  render,
  screen,
  waitFor,
  within
} from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { STORAGE_KEYS } from "@/lib/constants"
import { createAppError } from "@/lib/error-utils"
import {
  getPlasmoStoredValue,
  setPlasmoStoredValue
} from "@/lib/plasmo-global-storage"
import { extensionRpcClient } from "@/protocol/extension-client"
import { SettingsPage } from "../settings-page"

vi.mock("@/protocol/extension-client", () => ({
  extensionRpcClient: {
    call: vi.fn(async () => ({ models: [{ name: "llama3" }], failures: [] }))
  }
}))

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ i18n: { language: "en" }, t: (key: string) => key })
}))

vi.mock("@/components/language-selector", () => ({
  LanguageSelector: () => <div>language</div>
}))
vi.mock("@/components/performance-warning", () => ({
  PerformanceWarning: () => <div>performance</div>
}))
vi.mock("@/components/social-handles", () => ({
  SocialHandles: () => <div>social handles</div>
}))
vi.mock("@/components/social-link-button", () => ({
  SocialLinkButton: () => <a href="https://example.com">social</a>
}))
vi.mock("@/components/theme-toggle", () => ({
  ThemeToggle: () => <button type="button">theme</button>
}))
vi.mock("@/features/chat/components/chat-display-settings", () => ({
  ChatDisplaySettings: () => <div>chat display</div>
}))
vi.mock("@/features/chat/components/speech-settings", () => ({
  SpeechSettings: () => <div>speech</div>
}))
vi.mock("@/features/context/components/context-settings", () => ({
  ContextSettings: () => <div>context</div>
}))
vi.mock("@/features/model/components/content-extraction-settings", () => ({
  ContentExtractionSettings: () => <div>extraction</div>
}))
vi.mock("@/features/model/components/embedding-settings", () => ({
  EmbeddingSettings: () => <div>embeddings</div>
}))
vi.mock("@/features/model/components/model-settings-form", () => ({
  ModelSettingsForm: () => <div>models</div>
}))
vi.mock("@/features/model/components/provider-settings", () => ({
  ProviderSettings: () => (
    <div data-settings-focus-id="provider-base-url">providers</div>
  )
}))
vi.mock("@/features/prompt/components/prompt-template-manager", () => ({
  PromptTemplateManager: () => <div>prompts</div>
}))
vi.mock("@/options/components/guides", () => ({
  Guides: () => <div>guides</div>
}))
vi.mock("@/options/components/reset-storage", () => ({
  ResetStorage: () => <div>reset</div>
}))
vi.mock("@/options/components/shortcuts-settings", () => ({
  ShortcutsSettings: () => <div>shortcuts</div>
}))

describe("SettingsPage", () => {
  afterEach(() => {
    window.history.replaceState({}, "", "/")
  })

  it("opens on chat settings when a provider has models", async () => {
    render(<SettingsPage />)

    await waitFor(() => expect(extensionRpcClient.call).toHaveBeenCalled())
    expect(new URLSearchParams(window.location.search).get("tab")).toBe(
      "general"
    )
  })

  it("opens on providers and models when no provider has a model", async () => {
    vi.mocked(extensionRpcClient.call).mockResolvedValueOnce({
      models: [],
      failures: []
    })

    render(<SettingsPage />)

    await waitFor(() => {
      expect(new URLSearchParams(window.location.search).get("tab")).toBe(
        "models"
      )
    })
  })

  it("opens on providers and models when every provider fails", async () => {
    vi.mocked(extensionRpcClient.call).mockRejectedValueOnce(
      createAppError("Failed to fetch models", { kind: "provider" })
    )

    render(<SettingsPage />)

    await waitFor(() => {
      expect(new URLSearchParams(window.location.search).get("tab")).toBe(
        "models"
      )
    })
  })

  it("keeps chat settings when the background does not answer", async () => {
    vi.mocked(extensionRpcClient.call).mockRejectedValueOnce(
      createAppError("RPC timed out", { kind: "network" })
    )

    render(<SettingsPage />)

    await waitFor(() => expect(extensionRpcClient.call).toHaveBeenCalled())
    await Promise.resolve()
    expect(new URLSearchParams(window.location.search).get("tab")).toBe(
      "general"
    )
  })

  it("keeps a tab named by the URL even with no provider", async () => {
    vi.mocked(extensionRpcClient.call).mockClear()
    window.history.replaceState({}, "", "/?tab=privacy")

    render(<SettingsPage />)

    /** The tab is a lazy chunk; under CI coverage it loads past the 1s default. */
    await screen.findByText("reset", undefined, { timeout: 10_000 })
    expect(extensionRpcClient.call).not.toHaveBeenCalled()
    expect(new URLSearchParams(window.location.search).get("tab")).toBe(
      "privacy"
    )
  })

  it("resolves a legacy tab name to its current tab", () => {
    window.history.replaceState({}, "", "/?tab=model-behavior")

    render(<SettingsPage />)

    expect(new URLSearchParams(window.location.search).get("tab")).toBe(
      "models"
    )
  })

  it("focuses settings search with Ctrl+K", () => {
    render(<SettingsPage />)
    const searches = screen.getAllByRole("searchbox")

    fireEvent.keyDown(window, { key: "k", ctrlKey: true })

    expect(searches.some((search) => search === document.activeElement)).toBe(
      true
    )
  })

  it("renders mobile search before mobile navigation", () => {
    render(<SettingsPage />)

    const mobileSearch = screen.getAllByRole("searchbox")[1]
    const nav = screen.getAllByRole("navigation", {
      name: "settings.nav_label"
    })[1]

    expect(
      mobileSearch.compareDocumentPosition(nav) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
  })

  it("renders the global disclosure control only in the page header", () => {
    render(<SettingsPage />)

    const header = document.querySelector("header")
    const main = document.querySelector("main")

    expect(header).not.toBeNull()
    expect(main).not.toBeNull()
    expect(
      within(header as HTMLElement).getByRole("tablist", {
        name: "settings.disclosure.title"
      })
    ).toBeInTheDocument()
    expect(within(main as HTMLElement).queryByRole("tablist")).toBeNull()
    expect(
      document.querySelectorAll(
        '[data-settings-focus-id="settings-disclosure-level"]'
      )
    ).toHaveLength(1)
  })

  it("writes the selected record focus id into the URL", () => {
    render(<SettingsPage />)
    const search = screen.getAllByRole("searchbox")[0]

    fireEvent.change(search, { target: { value: "base url" } })
    fireEvent.click(screen.getAllByText("settings.providers.base_url")[0])

    const params = new URLSearchParams(window.location.search)
    expect(params.get("tab")).toBe("models")
    expect(params.get("focus")).toBe("provider-base-url")
  })

  it("reveals an advanced setting targeted by a deep link", async () => {
    window.history.replaceState({}, "", "/?tab=models&focus=temperature")

    render(<SettingsPage />)

    await waitFor(() => {
      expect(
        screen.getByRole("tab", {
          name: "settings.disclosure.levels.advanced"
        })
      ).toHaveAttribute("aria-selected", "true")
    })

    fireEvent.click(
      screen.getByRole("tab", {
        name: "settings.disclosure.levels.basic"
      })
    )

    await waitFor(() => {
      expect(
        screen.getByRole("tab", {
          name: "settings.disclosure.levels.basic"
        })
      ).toHaveAttribute("aria-selected", "true")
    })
  })

  it("shows power-only settings when the Power tab is selected", async () => {
    render(<SettingsPage />)

    const powerSummary = "settings.more_section.title"
    expect(screen.queryByText(powerSummary)).toBeNull()

    fireEvent.click(
      screen.getByRole("tab", {
        name: "settings.disclosure.levels.power"
      })
    )

    expect(await screen.findByText(powerSummary)).toBeInTheDocument()
  })

  it("does not let a late storage read undo a user selection", async () => {
    let resolveStoredLevel: (value: "basic") => void = () => undefined
    vi.mocked(getPlasmoStoredValue).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveStoredLevel = resolve
      })
    )

    render(<SettingsPage />)

    const advancedTab = screen.getByRole("tab", {
      name: "settings.disclosure.levels.advanced"
    })
    fireEvent.click(advancedTab)
    resolveStoredLevel("basic")

    await waitFor(() => {
      expect(advancedTab).toHaveAttribute("aria-selected", "true")
    })
  })

  it("does not let deep-link promotion downgrade a stored level", async () => {
    let resolveStoredLevel: (value: "advanced") => void = () => undefined
    vi.mocked(getPlasmoStoredValue).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveStoredLevel = resolve
      })
    )
    window.history.replaceState({}, "", "/?tab=general&focus=prompt-templates")

    render(<SettingsPage />)

    expect(
      screen.getByRole("tab", {
        name: "settings.disclosure.levels.power"
      })
    ).toHaveAttribute("aria-selected", "true")

    resolveStoredLevel("advanced")

    await waitFor(() => {
      expect(
        screen.getByRole("tab", {
          name: "settings.disclosure.levels.advanced"
        })
      ).toHaveAttribute("aria-selected", "true")
    })
    expect(setPlasmoStoredValue).not.toHaveBeenCalledWith(
      STORAGE_KEYS.UI.SETTINGS_LEVEL,
      "power"
    )
  })
})
