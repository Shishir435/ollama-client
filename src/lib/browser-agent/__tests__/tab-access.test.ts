import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  patterns: vi.fn(),
  matches: vi.fn(),
  neverRead: vi.fn()
}))

vi.mock("@/contents/url-filter", () => ({
  resolveExcludedUrlPatterns: (...args: unknown[]) => mocks.patterns(...args),
  urlMatchesAny: (...args: unknown[]) => mocks.matches(...args)
}))

vi.mock("@/lib/browser-api", () => ({
  browser: { tabs: { query: vi.fn() } }
}))

vi.mock("@/lib/per-site-profiles", () => ({
  isNeverReadUrl: (...args: unknown[]) => mocks.neverRead(...args)
}))

import { classifyAgentTabAccess } from "@/lib/browser-tab-access"

beforeEach(() => {
  vi.clearAllMocks()
  mocks.patterns.mockResolvedValue(["private.example"])
  mocks.matches.mockReturnValue(false)
  mocks.neverRead.mockResolvedValue(false)
})

describe("Agent tab access", () => {
  it.each([
    "file:///tmp/page",
    "ftp://example.com",
    "chrome://settings"
  ])("restricts %s before consulting site settings", async (url) => {
    await expect(classifyAgentTabAccess(url)).resolves.toBe("restricted")
    expect(mocks.patterns).not.toHaveBeenCalled()
  })

  it("reuses the content-extraction exclusion list", async () => {
    mocks.matches.mockReturnValue(true)
    await expect(
      classifyAgentTabAccess("https://private.example/account")
    ).resolves.toBe("excluded")
    expect(mocks.matches).toHaveBeenCalledWith(
      "https://private.example/account",
      ["private.example"]
    )
  })

  it("reuses never-read per-site profiles", async () => {
    mocks.neverRead.mockResolvedValue(true)
    await expect(
      classifyAgentTabAccess("https://example.com/private")
    ).resolves.toBe("excluded")
  })
})
