import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { PromptSelectorSheet } from "@/features/prompt/components/prompt-selector-sheet"

const mocks = vi.hoisted(() => ({
  incrementUsageCount: vi.fn()
}))

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: { count?: number }) =>
      ({
        "prompts.selector.title": "Prompt Templates",
        "prompts.selector.description": `${values?.count ?? 0} templates`,
        "prompts.selector.search_placeholder": "Search templates",
        "prompts.selector.sort_recent": "Recent",
        "prompts.selector.sort_popular": "Popular",
        "prompts.selector.sort_alphabetical": "A-Z",
        "prompts.selector.all_categories": "All",
        "prompts.selector.no_templates_title": "No templates found",
        "prompts.selector.no_templates_search": "Try search again",
        "prompts.selector.no_templates_empty": "No templates",
        "prompts.selector.clear_filters": "Clear filters",
        "prompts.selector.preview_user_prompt": "User Prompt",
        "prompts.selector.use_template": "Use Template",
        "prompts.selector.copy": "Copy",
        "tabs.select.view_content": "View extracted content",
        "common.settings.aria_label": "Settings",
        "common.settings.tooltip": "Settings",
        "common.settings.label": "Settings"
      })[key] ?? key
  })
}))

vi.mock("@/features/prompt/hooks/use-prompt-templates", () => ({
  usePromptTemplates: () => ({
    templates: [
      {
        id: "summarize",
        title: "Summarize Content",
        description: "Short summary",
        userPrompt: "Summarize {{selection}}",
        category: "Analysis",
        tags: ["summary"],
        usageCount: 2,
        createdAt: "2026-06-01T00:00:00.000Z"
      },
      {
        id: "translate",
        title: "Translate",
        userPrompt: "Translate to English",
        category: "Language",
        tags: [],
        usageCount: 0,
        createdAt: "2026-06-02T00:00:00.000Z"
      }
    ],
    incrementUsageCount: mocks.incrementUsageCount
  })
}))

vi.mock("@/lib/browser-api", () => ({
  openOptionsInTab: vi.fn()
}))

describe("PromptSelectorSheet", () => {
  beforeEach(() => {
    Element.prototype.getAnimations = vi.fn(() => [])
  })

  it("filters, previews, and inserts a resolved prompt from the sheet", async () => {
    const onSelect = vi.fn()

    render(
      <PromptSelectorSheet
        open
        onSelect={onSelect}
        onClose={vi.fn()}
        variableContext={{ selection: "selected text" }}
      />
    )

    expect(screen.getByText("Prompt Templates")).toBeInTheDocument()

    fireEvent.change(screen.getByPlaceholderText("Search templates"), {
      target: { value: "summarize" }
    })

    expect(screen.getByText("Summarize Content")).toBeInTheDocument()
    expect(screen.queryByText("Translate")).not.toBeInTheDocument()

    fireEvent.click(
      screen.getByRole("button", { name: "View extracted content" })
    )
    expect(screen.getByText("User Prompt")).toBeInTheDocument()
    expect(
      screen.getAllByText("Summarize selected text").length
    ).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole("button", { name: "Use Template" }))

    await waitFor(() =>
      expect(onSelect).toHaveBeenCalledWith("Summarize selected text")
    )
    await waitFor(() =>
      expect(mocks.incrementUsageCount).toHaveBeenCalledWith("summarize")
    )
  })
})
