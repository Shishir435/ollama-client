import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { SettingsSearch } from "../settings-search"

const messages: Record<string, string> = {
  "settings.tabs.general": "General",
  "settings.tabs.providers": "Providers",
  "settings.tabs.context": "Context",
  "settings.tabs.extraction": "Extraction",
  "settings.search.placeholder": "Search settings…",
  "settings.search.shortcut_label": "Shortcut to search settings",
  "settings.prompt_context_limits.max_tool_result_chars":
    "Max tool result chars",
  "settings.grounding_mode.label": "Answer only from selected page context",
  "settings.content_extraction.selection_actions.label": "Selection actions",
  "settings.presets.title": "Presets",
  "settings.presets.description": "Apply a tuned combination in one click.",
  "settings.presets.balanced.label": "Balanced",
  "settings.providers.base_url": "Base URL",
  "settings.providers.base_url_default": "Default",
  "settings.reset.modules.browser.title": "Browser Settings",
  "settings.reset.modules.browser.description": "Tab access & URL patterns",
  "settings.tabs.permissions": "Permissions",
  "settings.permissions.title": "Permissions & privacy",
  "settings.permissions.description":
    "See and control what this extension can access.",
  "settings.permissions.items.bookmarks.label": "Bookmarks",
  "settings.permissions.items.bookmarks.description": "Index saved pages.",
  "settings.shortcuts.browser.title": "Open from anywhere",
  "settings.shortcuts.browser.description":
    "Set a browser-level shortcut to open the side panel."
}

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    i18n: { language: "en" },
    t: (key: string) => messages[key] ?? key
  })
}))

describe("SettingsSearch", () => {
  it("shows registry matches as the user types", () => {
    render(<SettingsSearch onSelect={() => {}} />)
    const input = screen.getByRole("searchbox")
    fireEvent.change(input, { target: { value: "tool result" } })
    expect(screen.getByText("Max tool result chars")).toBeInTheDocument()
  })

  it("shows fuzzy provider matches", () => {
    render(<SettingsSearch onSelect={() => {}} />)
    const input = screen.getByRole("searchbox")
    fireEvent.change(input, { target: { value: "provder" } })
    expect(screen.getAllByText("Providers").length).toBeGreaterThan(0)
  })

  it("shows presets for partial preset queries", () => {
    render(<SettingsSearch onSelect={() => {}} />)
    const input = screen.getByRole("searchbox")
    fireEvent.change(input, { target: { value: "prese" } })
    expect(screen.getByText("Presets")).toBeInTheDocument()
  })

  it("shows matched child values with parent context", () => {
    render(<SettingsSearch onSelect={() => {}} />)
    const input = screen.getByRole("searchbox")
    fireEvent.change(input, { target: { value: "balanced" } })
    expect(screen.getByText("Balanced")).toBeInTheDocument()
    expect(screen.getByText("Presets")).toBeInTheDocument()
  })

  it("finds an individual Permissions control by label", () => {
    render(<SettingsSearch onSelect={() => {}} />)
    const input = screen.getByRole("searchbox")
    fireEvent.change(input, { target: { value: "bookmarks" } })
    expect(screen.getByText("Bookmarks")).toBeInTheDocument()
  })

  it("finds the Permissions tab via a privacy alias", () => {
    render(<SettingsSearch onSelect={() => {}} />)
    const input = screen.getByRole("searchbox")
    fireEvent.change(input, { target: { value: "privacy" } })
    expect(screen.getByText("Permissions & privacy")).toBeInTheDocument()
  })

  it("finds the browser-shortcuts pointer via a global-shortcut alias", () => {
    render(<SettingsSearch onSelect={() => {}} />)
    const input = screen.getByRole("searchbox")
    fireEvent.change(input, { target: { value: "global shortcut" } })
    expect(screen.getAllByText("Open from anywhere").length).toBeGreaterThan(0)
  })

  it("shows reset module rows", () => {
    render(<SettingsSearch onSelect={() => {}} />)
    const input = screen.getByRole("searchbox")
    fireEvent.change(input, { target: { value: "browser settings" } })
    expect(screen.getByText("Browser Settings")).toBeInTheDocument()
  })

  it("can show the mobile shortcut hint", () => {
    render(<SettingsSearch onSelect={() => {}} showShortcutHint />)
    expect(
      screen.getByLabelText("Shortcut to search settings")
    ).toBeInTheDocument()
    expect(screen.queryByText("Search settings")).toBeNull()
  })

  it("calls onSelect with the chosen record and clears the query", () => {
    const onSelect = vi.fn()
    render(<SettingsSearch onSelect={onSelect} />)
    const input = screen.getByRole("searchbox") as HTMLInputElement
    fireEvent.change(input, { target: { value: "answer only" } })
    fireEvent.click(screen.getByText("Answer only from selected page context"))
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({
        entryId: "grounded-only-mode",
        focusId: "grounded-only-mode",
        tab: "knowledge"
      })
    )
    expect(input.value).toBe("")
  })

  it("selects the first result on Enter", () => {
    const onSelect = vi.fn()
    render(<SettingsSearch onSelect={onSelect} />)
    const input = screen.getByRole("searchbox")
    fireEvent.change(input, { target: { value: "selection actions" } })
    fireEvent.keyDown(input, { key: "Enter" })
    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onSelect.mock.calls[0][0]).toMatchObject({
      entryId: "selection-actions-enabled",
      tab: "browser"
    })
  })

  it("shows nothing for an empty query", () => {
    render(<SettingsSearch onSelect={() => {}} />)
    expect(screen.queryByRole("listbox")).toBeNull()
  })

  it("exposes a named search field and result group", () => {
    render(<SettingsSearch onSelect={() => {}} />)
    const input = screen.getByRole("searchbox", { name: "Search settings…" })
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: "bookmarks" } })
    expect(
      screen.getByRole("group", { name: "Search settings…" })
    ).toBeInTheDocument()
    const results = screen.getAllByRole("button")
    expect(results[0]).toHaveAttribute("aria-current", "true")
  })

  it("moves the active option with the arrow keys and selects it on Enter", () => {
    const onSelect = vi.fn()
    render(<SettingsSearch onSelect={onSelect} />)
    const input = screen.getByRole("searchbox")
    fireEvent.change(input, { target: { value: "prese" } })
    const options = screen.getAllByRole("button")
    expect(options.length).toBeGreaterThan(1)

    fireEvent.keyDown(input, { key: "ArrowDown" })
    expect(options[1]).toHaveAttribute("aria-current", "true")

    fireEvent.keyDown(input, { key: "ArrowUp" })
    fireEvent.keyDown(input, { key: "ArrowUp" })
    const last = options[options.length - 1]
    expect(last).toHaveAttribute("aria-current", "true")

    fireEvent.keyDown(input, { key: "Enter" })
    expect(onSelect).toHaveBeenCalledTimes(1)
  })

  it("keeps focus in the input when a result is pressed", () => {
    render(<SettingsSearch onSelect={() => {}} />)
    const input = screen.getByRole("searchbox")
    fireEvent.change(input, { target: { value: "bookmarks" } })
    const pressed = fireEvent.mouseDown(screen.getAllByRole("button")[0])
    expect(pressed).toBe(false)
  })

  it("says so when nothing matches", () => {
    render(<SettingsSearch onSelect={() => {}} />)
    const input = screen.getByRole("searchbox")
    fireEvent.change(input, { target: { value: "zzzqqqxxx" } })
    expect(screen.queryAllByRole("button")).toHaveLength(0)
    expect(screen.getByText("settings.search.no_results")).toBeInTheDocument()
  })
})
