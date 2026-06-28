import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import type React from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ContextSettingsMenu } from "@/features/chat/components/chat-input/context-settings-menu"

const mocks = vi.hoisted(() => ({
  setUseRag: vi.fn(),
  setTabAccess: vi.fn(),
  setGroundedOnlyMode: vi.fn(),
  setSelectedTabIds: vi.fn(),
  refreshSelectedTabContents: vi.fn(),
  refreshTabs: vi.fn(),
  updateWebSearchConfig: vi.fn(),
  selectedTabIds: ["7"] as string[],
  perSiteProfiles: { profiles: [] as unknown[] }
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
    if (config.key === "browser-per-site-profiles") {
      return [mocks.perSiteProfiles, vi.fn()]
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
        "chat.context.preview_title": "The model will see",
        "chat.context.none": "No extra context",
        "chat.context.page": "Page",
        "chat.context.tabs": `${values?.count ?? 0} tabs`,
        "chat.context.files": `${values?.count ?? 0} files`,
        "chat.context.knowledge": "Knowledge",
        "chat.context.web": "Web",
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
        id: 9,
        title: "Private page",
        url: "https://example.com/private"
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
      },
      9: {
        title: "Private page",
        html: "Private extracted text"
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

vi.mock("@/features/model/hooks/use-selected-model-capabilities", () => ({
  useSelectedModelCapabilities: () => ({
    capabilities: { toolCalling: true, vision: false },
    isResolving: false
  })
}))

vi.mock("@/features/web-search/stores/web-search-config-store", () => ({
  useWebSearchConfig: () => ({
    config: { enabled: false },
    updateConfig: mocks.updateWebSearchConfig
  })
}))

vi.mock("@/features/tabs/stores/selected-tabs-store", () => ({
  useSelectedTabs: () => ({
    selectedTabIds: mocks.selectedTabIds,
    setSelectedTabIds: mocks.setSelectedTabIds
  })
}))

describe("ContextSettingsMenu", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.selectedTabIds = ["7"]
    mocks.perSiteProfiles = { profiles: [] }
  })

  it("keeps controls searchable and opens page preview in bounded dialog", () => {
    render(<ContextSettingsMenu />)

    fireEvent.click(screen.getByRole("button", { name: "Context" }))

    expect(screen.getByText("Tab+")).toBeInTheDocument()
    expect(screen.getByText("RAG+")).toBeInTheDocument()
    expect(screen.getByText("Web")).toBeInTheDocument()
    expect(screen.getByText("The model will see")).toBeInTheDocument()
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

  it("controls web search from the unified context tray", () => {
    render(<ContextSettingsMenu />)
    fireEvent.click(screen.getByRole("button", { name: "Context" }))
    fireEvent.click(screen.getByRole("button", { name: "Web" }))

    expect(mocks.updateWebSearchConfig).toHaveBeenCalledWith({ enabled: true })
  })

  it("hides and clears tabs matched by a never-read profile", () => {
    mocks.perSiteProfiles = {
      profiles: [
        {
          id: "example",
          name: "Example",
          pattern: "example.com",
          enabled: true,
          tabContext: "never",
          groundedOnly: "inherit"
        }
      ]
    }

    render(<ContextSettingsMenu />)
    fireEvent.click(screen.getByRole("button", { name: "Context" }))

    expect(screen.queryByText("Current page")).not.toBeInTheDocument()
    expect(mocks.setSelectedTabIds).toHaveBeenCalledWith([])
  })

  it("auto-selects tabs matched by an always-on profile", async () => {
    mocks.selectedTabIds = []
    mocks.perSiteProfiles = {
      profiles: [
        {
          id: "example",
          name: "Example",
          pattern: "example.com",
          enabled: true,
          tabContext: "always",
          groundedOnly: "inherit"
        }
      ]
    }

    render(<ContextSettingsMenu />)

    await waitFor(() =>
      expect(mocks.setSelectedTabIds).toHaveBeenCalledWith(["7", "9"])
    )
  })

  it("uses most-specific profile for overlapping tab rules", async () => {
    mocks.selectedTabIds = []
    mocks.perSiteProfiles = {
      profiles: [
        {
          id: "example",
          name: "Example",
          pattern: "example.com",
          enabled: true,
          tabContext: "always",
          groundedOnly: "inherit"
        },
        {
          id: "private",
          name: "Private",
          pattern: "example.com/private",
          enabled: true,
          tabContext: "never",
          groundedOnly: "inherit"
        }
      ]
    }

    render(<ContextSettingsMenu />)
    fireEvent.click(screen.getByRole("button", { name: "Context" }))

    expect(screen.getByText("Current page")).toBeInTheDocument()
    expect(screen.queryByText("Private page")).not.toBeInTheDocument()
    await waitFor(() =>
      expect(mocks.setSelectedTabIds).toHaveBeenCalledWith(["7"])
    )
  })
})
