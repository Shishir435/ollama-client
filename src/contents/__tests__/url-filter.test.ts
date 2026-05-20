import { beforeEach, describe, expect, it, vi } from "vitest"

import { DEFAULT_CONTENT_EXTRACTION_CONFIG } from "@/lib/constants"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"

import {
  isExcludedUrl,
  resolveExcludedUrlPatterns,
  urlMatchesAny
} from "../url-filter"

const mockedGet = vi.mocked(plasmoGlobalStorage.get)

describe("urlMatchesAny", () => {
  it("returns false when no patterns are provided", () => {
    expect(urlMatchesAny("https://example.com", [])).toBe(false)
  })

  it("matches via regex", () => {
    expect(
      urlMatchesAny("https://login.example.com/", ["^https://login\\."])
    ).toBe(true)
  })

  it("falls back to substring matching for invalid regex", () => {
    // Unbalanced bracket — RegExp constructor throws, substring fallback hits.
    expect(urlMatchesAny("https://example.com/admin", ["admin["])).toBe(false)
    expect(urlMatchesAny("https://example.com/admin[panel", ["admin["])).toBe(
      true
    )
  })

  it("any-match semantics: returns true on the first matching pattern", () => {
    expect(
      urlMatchesAny("https://x.foo.bar", ["never", "foo\\.bar", "also-never"])
    ).toBe(true)
  })

  it("returns false when no pattern matches", () => {
    expect(urlMatchesAny("https://safe.example.com", ["nope", "no-way"])).toBe(
      false
    )
  })
})

describe("resolveExcludedUrlPatterns", () => {
  beforeEach(() => {
    mockedGet.mockReset()
  })

  it("uses the patterns from the unified config when present", async () => {
    mockedGet.mockImplementation(async (key) => {
      if (key === "content-extraction-config") {
        return { excludedUrlPatterns: ["alpha", "beta"] }
      }
      return undefined
    })

    expect(await resolveExcludedUrlPatterns()).toEqual(["alpha", "beta"])
  })

  it("falls back to the legacy key when the new config has no patterns", async () => {
    mockedGet.mockImplementation(async (key) => {
      if (key === "content-extraction-config") {
        return { excludedUrlPatterns: [] }
      }
      if (key === "exclude-url-pattern") {
        return ["legacy-1", "legacy-2"]
      }
      return undefined
    })

    expect(await resolveExcludedUrlPatterns()).toEqual(["legacy-1", "legacy-2"])
  })

  it("falls through to default patterns when neither source has data", async () => {
    mockedGet.mockResolvedValue(undefined)
    expect(await resolveExcludedUrlPatterns()).toEqual(
      DEFAULT_CONTENT_EXTRACTION_CONFIG.excludedUrlPatterns
    )
  })

  it("does NOT fall through to legacy when the new config has non-empty patterns", async () => {
    mockedGet.mockImplementation(async (key) => {
      if (key === "content-extraction-config") {
        return { excludedUrlPatterns: ["only-new"] }
      }
      if (key === "exclude-url-pattern") {
        // Should never be consulted.
        return ["should-be-ignored"]
      }
      return undefined
    })

    expect(await resolveExcludedUrlPatterns()).toEqual(["only-new"])
  })
})

describe("isExcludedUrl", () => {
  beforeEach(() => {
    mockedGet.mockReset()
  })

  it("returns true when the URL matches a pattern", async () => {
    mockedGet.mockImplementation(async (key) => {
      if (key === "content-extraction-config") {
        return { excludedUrlPatterns: ["bank\\.example"] }
      }
      return undefined
    })
    expect(await isExcludedUrl("https://bank.example.com/login")).toBe(true)
  })

  it("returns false when the URL matches no pattern", async () => {
    mockedGet.mockImplementation(async (key) => {
      if (key === "content-extraction-config") {
        return { excludedUrlPatterns: ["bank\\.example"] }
      }
      return undefined
    })
    expect(await isExcludedUrl("https://news.example.com/article")).toBe(false)
  })
})
