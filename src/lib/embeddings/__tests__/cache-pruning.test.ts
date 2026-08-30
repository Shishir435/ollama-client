import { describe, expect, it } from "vitest"
import { pruneSearchCache } from "../cache-pruning"

describe("pruneSearchCache", () => {
  it("removes expired entries before applying the size limit", () => {
    const cache = new Map([
      ["expired", { results: [], timestamp: 0 }],
      ["old", { results: [], timestamp: 8_000 }],
      ["new", { results: [], timestamp: 9_500 }]
    ])

    pruneSearchCache(cache, 10_000, 1_000, 1)

    expect([...cache.keys()]).toEqual(["new"])
  })

  it("keeps the newest entries when the cache exceeds its limit", () => {
    const cache = new Map([
      ["oldest", { results: [], timestamp: 1 }],
      ["middle", { results: [], timestamp: 2 }],
      ["newest", { results: [], timestamp: 3 }]
    ])

    pruneSearchCache(cache, 3, 10_000, 2)

    expect([...cache.keys()]).toEqual(["middle", "newest"])
  })

  it("evicts by insertion order without requiring timestamp sorting", () => {
    const cache = new Map([
      ["least-recent", { results: [], timestamp: 3 }],
      ["recent", { results: [], timestamp: 1 }],
      ["most-recent", { results: [], timestamp: 2 }]
    ])

    pruneSearchCache(cache, 3, 10_000, 2)

    expect([...cache.keys()]).toEqual(["recent", "most-recent"])
  })
})
