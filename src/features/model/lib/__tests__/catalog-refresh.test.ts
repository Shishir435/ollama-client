import { describe, expect, it } from "vitest"
import {
  CATALOG_REFRESH_CHOICES_MS,
  catalogStaleTimeMs,
  DEFAULT_CATALOG_REFRESH_MS,
  MIN_CATALOG_REFRESH_MS,
  normalizeCatalogRefreshMs
} from "../catalog-refresh"

describe("catalog refresh interval", () => {
  it("falls back to the default for anything that is not a number", () => {
    for (const value of [undefined, null, "60000", Number.NaN, {}]) {
      expect(normalizeCatalogRefreshMs(value)).toBe(DEFAULT_CATALOG_REFRESH_MS)
    }
  })

  it("treats zero and negatives as off", () => {
    expect(normalizeCatalogRefreshMs(0)).toBe(0)
    expect(normalizeCatalogRefreshMs(-1)).toBe(0)
  })

  it("refuses to poll faster than the floor", () => {
    // The setting syncs, so an older build on another device can send a value
    // this one would never offer.
    expect(normalizeCatalogRefreshMs(1)).toBe(MIN_CATALOG_REFRESH_MS)
    expect(normalizeCatalogRefreshMs(10_000)).toBe(MIN_CATALOG_REFRESH_MS)
  })

  it("snaps an off-menu value onto a real choice", () => {
    // Anything else leaves the select with no matching item — a blank trigger
    // over an interval the queries are really using.
    expect(CATALOG_REFRESH_CHOICES_MS).toContain(
      normalizeCatalogRefreshMs(45_000)
    )
    expect(CATALOG_REFRESH_CHOICES_MS).toContain(
      normalizeCatalogRefreshMs(3_600_000)
    )
    expect(normalizeCatalogRefreshMs(59_000)).toBe(60_000)
    expect(normalizeCatalogRefreshMs(3_600_000)).toBe(300_000)
  })

  it("sends a tie to the slower choice", () => {
    // Halfway between 30s and 60s. Fewer requests is the point of the setting.
    expect(normalizeCatalogRefreshMs(45_000)).toBe(60_000)
  })

  it("keeps every offered choice unchanged", () => {
    for (const choice of CATALOG_REFRESH_CHOICES_MS) {
      expect(normalizeCatalogRefreshMs(choice)).toBe(choice)
    }
  })

  it("never lets a slow or disabled poll refetch on every mount", () => {
    expect(catalogStaleTimeMs(0)).toBe(DEFAULT_CATALOG_REFRESH_MS)
    expect(catalogStaleTimeMs(30_000)).toBe(DEFAULT_CATALOG_REFRESH_MS)
    expect(catalogStaleTimeMs(300_000)).toBe(300_000)
  })
})
