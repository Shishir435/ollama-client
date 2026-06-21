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
      settings
    )
  })
})
