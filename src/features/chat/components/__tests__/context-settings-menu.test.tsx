import { fireEvent, render, screen } from "@testing-library/react"
import type React from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ContextSettingsMenu } from "@/features/chat/components/chat-input/context-settings-menu"

const mocks = vi.hoisted(() => ({
  setUseRag: vi.fn(),
  setTabAccess: vi.fn(),
  setGroundedOnlyMode: vi.fn(),
  setSelectedTabIds: vi.fn(),
  refreshSelectedTabContents: vi.fn(),
  refreshTabs: vi.fn()
}))

vi.mock("@plasmohq/storage/hook", () => ({
  useStorage: vi.fn((config: { key: string }) => {
    if (config.key === "embeddings-use-rag") {
      return [true, mocks.setUseRag]
    }
    if (config.key === "browser-tab-access") {
      return [true, mocks.setTabAccess]
    }
    if (config.key === "chat-grounded-only-mode") {
      return [false, mocks.setGroundedOnlyMode]
    }
    return [undefined, vi.fn()]
  })
}))

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: { count?: number }) =>
      ({
        "tabs.context": "Context",
        "tabs.toggle.label_on": "Tab+",
        "tabs.toggle.label_off": "Tabs",
        "tabs.select.placeholder": "Select open tabs",
        "tabs.select.search_placeholder": "Search tabs...",
        "tabs.select.refresh_now": "Refresh context now",
        "tabs.select.view_content": "View extracted content",
        "tabs.inspector.untitled": "Untitled",
        "tabs.inspector.no_content": "(No extracted content yet)",
        "tabs.inspector.chars": `${values?.count ?? 0} chars`,
        "chat.input.rag_toggle_on": "RAG+",
        "chat.input.rag_toggle_off": "RAG",
        "settings.grounding_mode.label":
          "Answer only from selected page context"
      })[key] ?? key
  })
}))

vi.mock("@/components/ui/scroll-area", () => ({
  ScrollArea: ({ children, className }: React.ComponentProps<"div">) => (
    <div className={className}>{children}</div>
  )
}))

vi.mock("@/features/tabs/hooks/use-open-tab", () => ({
  useOpenTabs: () => ({
    tabs: [
      {
        id: 7,
        title: "Current page",
        url: "https://example.com"
      },
      {
        id: 8,
        title: "Chrome internals",
        url: "chrome://extensions"
      }
    ],
    refreshTabs: mocks.refreshTabs
  })
}))

vi.mock("@/features/tabs/hooks/use-tab-contents", () => ({
  useTabContents: () => ({
    tabContents: {
      7: {
        title: "Current page",
        html: "Extracted text from current page"
      }
    },
    refreshSelectedTabContents: mocks.refreshSelectedTabContents
  })
}))

vi.mock("@/features/tabs/hooks/use-tab-status-map", () => ({
  useTabStatusMap: () => () => ({
    loading: false,
    error: null,
    data: {}
  })
}))

vi.mock("@/features/tabs/stores/selected-tabs-store", () => ({
  useSelectedTabs: () => ({
    selectedTabIds: ["7"],
    setSelectedTabIds: mocks.setSelectedTabIds
  })
}))

describe("ContextSettingsMenu", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("keeps controls searchable and opens page preview in bounded dialog", () => {
    render(<ContextSettingsMenu />)

    fireEvent.click(screen.getByRole("button", { name: "Context" }))

    expect(screen.getByText("Tab+")).toBeInTheDocument()
    expect(screen.getByText("RAG+")).toBeInTheDocument()
    expect(
      screen.getByText("Answer only from selected page context")
    ).toBeInTheDocument()
    expect(screen.getAllByText("Current page").length).toBeGreaterThan(0)
    expect(screen.queryByText("Chrome internals")).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText("Search tabs..."), {
      target: { value: "current" }
    })

    fireEvent.click(
      screen.getByRole("button", { name: "View extracted content" })
    )

    expect(screen.getByRole("dialog")).toBeInTheDocument()
    expect(
      screen.getAllByText("Extracted text from current page").length
    ).toBeGreaterThan(0)
    expect(screen.getByText("32 chars")).toBeInTheDocument()
  })
})
