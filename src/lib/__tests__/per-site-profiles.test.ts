import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  getPlasmoStoredValue: vi.fn(),
  setPlasmoStoredValue: vi.fn()
}))

vi.mock("@/lib/plasmo-global-storage", () => ({
  getPlasmoStoredValue: mocks.getPlasmoStoredValue,
  setPlasmoStoredValue: mocks.setPlasmoStoredValue
}))

describe("per-site profiles", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getPlasmoStoredValue.mockResolvedValue(undefined)
  })

  it("returns default settings when none are stored", async () => {
    const { getPerSiteProfileSettings } = await import(
      "@/lib/per-site-profiles"
    )

    await expect(getPerSiteProfileSettings()).resolves.toEqual({
      profiles: []
    })
  })

  it("matches enabled profiles by URL pattern", async () => {
    const { getMatchingPerSiteProfile } = await import(
      "@/lib/per-site-profiles"
    )

    const profile = {
      id: "github",
      name: "GitHub",
      pattern: "github.com",
      enabled: true,
      tabContext: "always" as const,
      groundedOnly: "inherit" as const
    }

    expect(
      getMatchingPerSiteProfile("https://github.com/pull/1", {
        profiles: [profile]
      })
    ).toBe(profile)
  })

  it("does not treat dots in domain patterns as regex wildcards", async () => {
    const { profilePatternMatchesUrl } = await import("@/lib/per-site-profiles")

    expect(
      profilePatternMatchesUrl(
        "github.com",
        "https://githubXcom.unrelated.org/page"
      )
    ).toBe(false)
    expect(
      profilePatternMatchesUrl("github.com", "https://github.com.evil")
    ).toBe(false)
    expect(
      profilePatternMatchesUrl("github.com", "https://github.com/pull/1")
    ).toBe(true)
  })

  it("supports explicit regex patterns", async () => {
    const { profilePatternMatchesUrl } = await import("@/lib/per-site-profiles")

    expect(
      profilePatternMatchesUrl(
        "^https://twitter\\.com/.*",
        "https://twitter.com/home"
      )
    ).toBe(true)
  })

  it("prefers the most specific matching profile", async () => {
    const { getMatchingPerSiteProfile } = await import(
      "@/lib/per-site-profiles"
    )

    const broad = {
      id: "github",
      name: "GitHub",
      pattern: "github.com",
      enabled: true,
      tabContext: "always" as const,
      groundedOnly: "inherit" as const
    }
    const specific = {
      id: "github-pulls",
      name: "GitHub pulls",
      pattern: "github.com/pull",
      enabled: true,
      tabContext: "never" as const,
      groundedOnly: "always" as const
    }

    expect(
      getMatchingPerSiteProfile("https://github.com/pull/1", {
        profiles: [broad, specific]
      })
    ).toBe(specific)
  })

  it("ignores disabled profiles", async () => {
    const { getMatchingPerSiteProfile } = await import(
      "@/lib/per-site-profiles"
    )

    expect(
      getMatchingPerSiteProfile("https://mail.example.com", {
        profiles: [
          {
            id: "mail",
            name: "Mail",
            pattern: "mail.example.com",
            enabled: false,
            tabContext: "never",
            groundedOnly: "inherit"
          }
        ]
      })
    ).toBeUndefined()
  })

  it("checks never-read profile state from stored settings", async () => {
    const { isNeverReadUrl } = await import("@/lib/per-site-profiles")

    mocks.getPlasmoStoredValue.mockResolvedValue({
      profiles: [
        {
          id: "mail",
          name: "Mail",
          pattern: "mail.*",
          enabled: true,
          tabContext: "never",
          groundedOnly: "inherit"
        }
      ]
    })

    await expect(
      isNeverReadUrl("https://mail.example.com/inbox")
    ).resolves.toBe(true)
    await expect(isNeverReadUrl("https://docs.example.com")).resolves.toBe(
      false
    )
  })

  it("persists profile settings", async () => {
    const { setPerSiteProfileSettings } = await import(
      "@/lib/per-site-profiles"
    )

    const settings = {
      profiles: [
        {
          id: "docs",
          name: "Docs",
          pattern: "docs.example.com",
          enabled: true,
          tabContext: "always" as const,
          groundedOnly: "always" as const
        }
      ]
    }

    await setPerSiteProfileSettings(settings)
    expect(mocks.setPlasmoStoredValue).toHaveBeenCalledWith(
      "browser-per-site-profiles",
      { profiles: settings.profiles }
    )
  })

  it("resolves grounded-only overrides from matching profiles", async () => {
    const { resolveGroundedOnlyModeForUrls } = await import(
      "@/lib/per-site-profiles"
    )

    expect(
      resolveGroundedOnlyModeForUrls(
        ["https://docs.example.com/page"],
        [
          {
            id: "docs",
            name: "Docs",
            pattern: "docs.example.com",
            enabled: true,
            tabContext: "inherit",
            groundedOnly: "always"
          }
        ],
        false
      )
    ).toBe(true)

    expect(
      resolveGroundedOnlyModeForUrls(
        ["https://chat.example.com"],
        [
          {
            id: "chat",
            name: "Chat",
            pattern: "chat.example.com",
            enabled: true,
            tabContext: "inherit",
            groundedOnly: "never"
          }
        ],
        true
      )
    ).toBe(false)
  })

  it("resolves grounded-only with the most specific matching profile", async () => {
    const { resolveGroundedOnlyModeForUrls } = await import(
      "@/lib/per-site-profiles"
    )

    expect(
      resolveGroundedOnlyModeForUrls(
        ["https://github.com/private"],
        [
          {
            id: "github",
            name: "GitHub",
            pattern: "github.com",
            enabled: true,
            tabContext: "inherit",
            groundedOnly: "always"
          },
          {
            id: "github-private",
            name: "GitHub private",
            pattern: "github.com/private",
            enabled: true,
            tabContext: "inherit",
            groundedOnly: "never"
          }
        ],
        true
      )
    ).toBe(false)
  })
})
