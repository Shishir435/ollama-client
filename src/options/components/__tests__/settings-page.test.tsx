import { fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { SettingsPage } from "../settings-page"

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
vi.mock("@/features/chat/components", () => ({
  ChatDisplaySettings: () => <div>chat display</div>,
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

  it("focuses settings search with Ctrl+K", () => {
    render(<SettingsPage />)
    const searches = screen.getAllByRole("combobox")

    fireEvent.keyDown(window, { key: "k", ctrlKey: true })

    expect(searches.some((search) => search === document.activeElement)).toBe(
      true
    )
  })

  it("renders mobile search before mobile navigation", () => {
    render(<SettingsPage />)

    const mobileSearch = screen.getAllByRole("combobox")[1]
    const nav = screen.getAllByRole("navigation", {
      name: "Settings navigation"
    })[1]

    expect(
      mobileSearch.compareDocumentPosition(nav) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
  })

  it("writes the selected record focus id into the URL", () => {
    render(<SettingsPage />)
    const search = screen.getAllByRole("combobox")[0]

    fireEvent.change(search, { target: { value: "base url" } })
    fireEvent.mouseDown(screen.getAllByText("settings.providers.base_url")[0])

    const params = new URLSearchParams(window.location.search)
    expect(params.get("tab")).toBe("providers")
    expect(params.get("focus")).toBe("provider-base-url")
  })
})
