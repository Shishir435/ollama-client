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
    const input = screen.getByRole("combobox")
    fireEvent.change(input, { target: { value: "tool result" } })
    expect(
      screen.getByRole("option", { name: /Max tool result chars/ })
    ).toBeInTheDocument()
  })

  it("shows fuzzy provider matches", () => {
    render(<SettingsSearch onSelect={() => {}} />)
    const input = screen.getByRole("combobox")
    fireEvent.change(input, { target: { value: "provder" } })
    expect(
      screen.getAllByRole("option", { name: /Providers/ }).length
    ).toBeGreaterThan(0)
  })

  it("shows presets for partial preset queries", () => {
    render(<SettingsSearch onSelect={() => {}} />)
    const input = screen.getByRole("combobox")
    fireEvent.change(input, { target: { value: "prese" } })
    expect(screen.getByRole("option", { name: /Presets/ })).toBeInTheDocument()
  })

  it("shows matched child values with parent context", () => {
    render(<SettingsSearch onSelect={() => {}} />)
    const input = screen.getByRole("combobox")
    fireEvent.change(input, { target: { value: "balanced" } })
    expect(screen.getByRole("option", { name: /Balanced/ })).toBeInTheDocument()
    expect(screen.getByRole("option", { name: /Presets/ })).toBeInTheDocument()
  })

  it("finds an individual Permissions control by label", () => {
    render(<SettingsSearch onSelect={() => {}} />)
    const input = screen.getByRole("combobox")
    fireEvent.change(input, { target: { value: "bookmarks" } })
    expect(
      screen.getByRole("option", { name: /Bookmarks/ })
    ).toBeInTheDocument()
  })

  it("finds the Permissions tab via a privacy alias", () => {
    render(<SettingsSearch onSelect={() => {}} />)
    const input = screen.getByRole("combobox")
    fireEvent.change(input, { target: { value: "privacy" } })
    expect(
      screen.getByRole("option", { name: /Permissions & privacy/ })
    ).toBeInTheDocument()
  })

  it("finds the browser-shortcuts pointer via a global-shortcut alias", () => {
    render(<SettingsSearch onSelect={() => {}} />)
    const input = screen.getByRole("combobox")
    fireEvent.change(input, { target: { value: "global shortcut" } })
    expect(
      screen.getAllByRole("option", { name: /Open from anywhere/ }).length
    ).toBeGreaterThan(0)
  })

  it("shows reset module rows", () => {
    render(<SettingsSearch onSelect={() => {}} />)
    const input = screen.getByRole("combobox")
    fireEvent.change(input, { target: { value: "browser settings" } })
    expect(
      screen.getByRole("option", { name: /Browser Settings/ })
    ).toBeInTheDocument()
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
    const input = screen.getByRole("combobox") as HTMLInputElement
    fireEvent.change(input, { target: { value: "answer only" } })
    fireEvent.keyDown(screen.getByRole("listbox"), { key: "Enter" })
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
    const input = screen.getByRole("combobox")
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
    const input = screen.getByRole("combobox", { name: "Search settings…" })
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: "bookmarks" } })
    expect(
      screen.getByRole("listbox", { name: "Search settings…" })
    ).toBeInTheDocument()
    const results = screen.getAllByRole("option")
    expect((results[0] as HTMLOptionElement).selected).toBe(true)
    expect(input).toHaveAttribute("aria-activedescendant", results[0].id)
  })

  it("moves the active option with the arrow keys and selects it on Enter", () => {
    const onSelect = vi.fn()
    render(<SettingsSearch onSelect={onSelect} />)
    const input = screen.getByRole("combobox")
    fireEvent.change(input, { target: { value: "prese" } })
    const options = screen.getAllByRole("option")
    expect(options.length).toBeGreaterThan(1)

    fireEvent.keyDown(input, { key: "ArrowDown" })
    expect((options[1] as HTMLOptionElement).selected).toBe(true)
    expect(input).toHaveAttribute("aria-activedescendant", options[1].id)

    fireEvent.keyDown(input, { key: "ArrowUp" })
    fireEvent.keyDown(input, { key: "ArrowUp" })
    const last = options[options.length - 1]
    expect((last as HTMLOptionElement).selected).toBe(true)
    expect(input).toHaveAttribute("aria-activedescendant", last.id)

    fireEvent.keyDown(input, { key: "Enter" })
    expect(onSelect).toHaveBeenCalledTimes(1)
  })

  it("lets a keyboard user choose from the native result list", () => {
    const onSelect = vi.fn()
    render(<SettingsSearch onSelect={onSelect} />)
    const input = screen.getByRole("combobox")
    fireEvent.change(input, { target: { value: "bookmarks" } })
    const results = screen.getByRole("listbox")
    expect(screen.getByRole("option")).toBeInTheDocument()
    fireEvent.keyDown(results, { key: "Enter" })
    expect(onSelect).toHaveBeenCalledTimes(1)
  })

  it("does not activate a result when native selection changes", () => {
    const onSelect = vi.fn()
    render(<SettingsSearch onSelect={onSelect} />)
    const input = screen.getByRole("combobox")
    fireEvent.change(input, { target: { value: "prese" } })
    const results = screen.getByRole("listbox")
    const options = screen.getAllByRole("option")
    expect(options.length).toBeGreaterThan(1)

    fireEvent.change(results, { target: { value: "1" } })

    expect(onSelect).not.toHaveBeenCalled()
    expect((options[1] as HTMLOptionElement).selected).toBe(true)

    fireEvent.keyDown(results, { key: "Enter" })
    expect(onSelect).toHaveBeenCalledTimes(1)
  })

  it("chooses a result when the already-selected option is clicked", () => {
    const onSelect = vi.fn()
    render(<SettingsSearch onSelect={onSelect} />)
    const input = screen.getByRole("combobox")
    fireEvent.change(input, { target: { value: "bookmarks" } })
    fireEvent.click(screen.getByRole("option"))
    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(input).toHaveValue("")
  })

  it("chooses a result when an unselected option is clicked", () => {
    const onSelect = vi.fn()
    render(<SettingsSearch onSelect={onSelect} />)
    const input = screen.getByRole("combobox")
    fireEvent.change(input, { target: { value: "prese" } })
    const options = screen.getAllByRole("option")
    expect(options.length).toBeGreaterThan(1)
    fireEvent.click(options[1])
    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(input).toHaveValue("")
  })

  it("says so when nothing matches", () => {
    render(<SettingsSearch onSelect={() => {}} />)
    const input = screen.getByRole("combobox")
    fireEvent.change(input, { target: { value: "zzzqqqxxx" } })
    expect(screen.queryAllByRole("option")).toHaveLength(0)
    expect(screen.getByText("settings.search.no_results")).toBeInTheDocument()
  })
})
