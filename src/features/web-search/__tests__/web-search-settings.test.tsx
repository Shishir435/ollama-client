import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { WebSearchProviderConfig } from "@/lib/tools/web-search"
import { WebSearchSettings } from "../components/web-search-settings"

let config: WebSearchProviderConfig
const updateConfig = vi.fn((updates: Partial<WebSearchProviderConfig>) => {
  config = { ...config, ...updates }
})

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values ? `${key}:${JSON.stringify(values)}` : key
  })
}))

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() })
}))

vi.mock("../stores/web-search-config-store", () => ({
  useWebSearchConfig: () => ({ config, updateConfig })
}))

describe("WebSearchSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    config = {
      provider: "searxng",
      enabled: false,
      endpoint: "http://localhost:8080",
      count: 5,
      safeSearch: "moderate"
    }
  })

  it("renders SearXNG endpoint config by default", () => {
    render(<WebSearchSettings />)

    expect(
      screen.getByLabelText("settings.web_search.endpoint.label")
    ).toHaveAttribute("type", "url")
    expect(
      screen.queryByLabelText("settings.web_search.api_key.label")
    ).not.toBeInTheDocument()
    expect(
      screen.queryByText("https://api.search.brave.com/res/v1/web/search")
    ).not.toBeInTheDocument()
    expect(
      screen.getByText("settings.web_search.searxng_pages.label")
    ).toBeInTheDocument()
  })

  it("masks API keys for key-based providers", () => {
    config = {
      provider: "brave",
      enabled: true,
      apiKey: "secret",
      count: 5,
      safeSearch: "moderate"
    }

    render(<WebSearchSettings />)

    expect(
      screen.getByLabelText("settings.web_search.api_key.label")
    ).toHaveAttribute("type", "password")
    expect(
      screen.queryByLabelText("settings.web_search.endpoint.label")
    ).not.toBeInTheDocument()
    expect(
      screen.getByText("https://api.search.brave.com/res/v1/web/search")
    ).toBeInTheDocument()
    expect(
      screen.queryByText("settings.web_search.searxng_pages.label")
    ).not.toBeInTheDocument()
  })

  it("persists enable toggle updates", () => {
    render(<WebSearchSettings />)

    fireEvent.click(
      screen.getByRole("switch", {
        name: "settings.web_search.enable.label"
      })
    )

    expect(updateConfig).toHaveBeenCalledWith({ enabled: true })
  })

  it("shows the execution source and client privacy disclosure", () => {
    render(<WebSearchSettings />)

    expect(
      screen.getByLabelText("settings.web_search.execution_source.label")
    ).toHaveTextContent("settings.web_search.execution_source.client")
    expect(
      screen.getByText("settings.web_search.privacy.client")
    ).toBeInTheDocument()
    expect(
      screen.queryByLabelText("settings.web_search.native_mode.label")
    ).not.toBeInTheDocument()
  })

  it("shows native freshness and disclosure for native-only search", () => {
    config.executionSource = "native"
    config.nativeMode = "live"
    render(<WebSearchSettings />)

    expect(
      screen.getByLabelText("settings.web_search.native_mode.label")
    ).toHaveTextContent("settings.web_search.native_mode.live")
    expect(
      screen.getByText("settings.web_search.privacy.native")
    ).toBeInTheDocument()
    expect(
      screen.queryByLabelText("settings.web_search.provider.label")
    ).not.toBeInTheDocument()
  })

  it("shows friendly provider and safety labels while selects are closed", () => {
    render(<WebSearchSettings />)

    expect(
      screen.getByLabelText("settings.web_search.provider.label")
    ).toHaveTextContent("settings.web_search.providers.searxng")
    expect(
      screen.getByLabelText("settings.web_search.safe_search.label")
    ).toHaveTextContent("settings.web_search.safe_search.moderate")
  })

  it("validates config before test search", async () => {
    config = {
      provider: "brave",
      enabled: true,
      count: 5,
      safeSearch: "moderate"
    }

    render(<WebSearchSettings />)
    fireEvent.click(
      screen.getByRole("button", {
        name: "settings.web_search.test.button"
      })
    )

    await waitFor(() => {
      expect(
        screen.getByText("settings.web_search.test.error_title")
      ).toBeInTheDocument()
    })
  })
})
