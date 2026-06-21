import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { SiteSpecificOverrides } from "@/features/model/components/site-specific-overrides"
import { DEFAULT_CONTENT_EXTRACTION_CONFIG } from "@/lib/constants"
import type { ContentExtractionConfig } from "@/types"

vi.mock("react-i18next", () => ({
  Trans: ({ i18nKey }: { i18nKey: string }) => <span>{i18nKey}</span>,
  useTranslation: () => ({ t: (key: string) => key })
}))

const makeConfig = (): ContentExtractionConfig => ({
  ...DEFAULT_CONTENT_EXTRACTION_CONFIG,
  siteOverrides: {
    "docs.example.com": {
      scrollStrategy: "smart",
      scrollDepth: 0.8
    }
  }
})

describe("SiteSpecificOverrides", () => {
  const handlers = {
    onAddSiteOverride: vi.fn(),
    onRemoveSiteOverride: vi.fn(),
    onUpdateSiteOverride: vi.fn(),
    onUpdateSiteProfile: vi.fn()
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("shows context profile controls alongside extraction controls", () => {
    render(
      <SiteSpecificOverrides
        config={makeConfig()}
        perSiteProfiles={[
          {
            id: "docs",
            name: "Docs",
            pattern: "docs.example.com",
            enabled: true,
            tabContext: "always",
            groundedOnly: "never"
          }
        ]}
        {...handlers}
      />
    )

    expect(
      screen.getByText("model.site_overrides.scroll_strategy_label")
    ).toBeInTheDocument()
    expect(screen.getByText("model.site_overrides.scroll_depth_label"))
      .toBeInTheDocument
    expect(
      screen.getByText("settings.permissions.siteProfiles.fields.tabContext")
    ).toBeInTheDocument()
    expect(
      screen.getByText("settings.permissions.siteProfiles.fields.groundedOnly")
    ).toBeInTheDocument()
  })

  it("adds a new site override pattern", () => {
    render(
      <SiteSpecificOverrides
        config={{ ...makeConfig(), siteOverrides: {} }}
        perSiteProfiles={[]}
        {...handlers}
      />
    )

    fireEvent.change(
      screen.getByPlaceholderText("model.site_overrides.pattern_placeholder"),
      {
        target: { value: "mail.example.com" }
      }
    )
    fireEvent.click(
      screen.getByRole("button", { name: /model.site_overrides.add_button/ })
    )

    expect(handlers.onAddSiteOverride).toHaveBeenCalledWith("mail.example.com")
  })
})
