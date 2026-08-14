import { describe, expect, it } from "vitest"
import { ModelWarmupCache } from "../model-warmup-cache"

describe("ModelWarmupCache", () => {
  it("suppresses warmup for half the configured keep-alive window", () => {
    const cache = new ModelWarmupCache()
    cache.record("ollama:llama3", 10_000, 1_000)

    expect(cache.shouldWarmup("ollama:llama3", 10_000, 6_000)).toBe(false)
    expect(cache.shouldWarmup("ollama:llama3", 10_000, 6_001)).toBe(true)
  })

  it("never warms when keep-alive explicitly disables residency", () => {
    expect(new ModelWarmupCache().shouldWarmup("ollama:llama3", 0)).toBe(false)
  })

  it("bounds history without evicting recently refreshed models", () => {
    const cache = new ModelWarmupCache()
    cache.record("model-0", undefined, 0)

    for (let index = 1; index < 100; index++) {
      cache.record(`model-${index}`, undefined, index)
    }
    cache.record("model-0", undefined, 100)
    cache.record("model-100", undefined, 101)

    expect(cache.shouldWarmup("model-1", undefined, 102)).toBe(true)
    expect(cache.shouldWarmup("model-0", undefined, 102)).toBe(false)
  })

  it("starts empty after worker-local state is recreated", () => {
    const firstWorker = new ModelWarmupCache()
    firstWorker.record("ollama:llama3", 10_000, 1_000)

    const replacementWorker = new ModelWarmupCache()
    expect(replacementWorker.shouldWarmup("ollama:llama3", 10_000, 1_001)).toBe(
      true
    )
  })
})
