import { afterEach, describe, expect, it, vi } from "vitest"
import {
  motionSafeScrollBehavior,
  prefersReducedMotion
} from "../reduced-motion"

const stubMatchMedia = (matches: boolean) => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: query === "(prefers-reduced-motion: reduce)" && matches,
      media: query
    }))
  )
}

describe("reduced motion", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("scrolls instantly when the user prefers reduced motion", () => {
    stubMatchMedia(true)
    expect(prefersReducedMotion()).toBe(true)
    expect(motionSafeScrollBehavior()).toBe("auto")
  })

  it("scrolls smoothly otherwise", () => {
    stubMatchMedia(false)
    expect(prefersReducedMotion()).toBe(false)
    expect(motionSafeScrollBehavior()).toBe("smooth")
  })

  it("reports no preference when matchMedia is unavailable", () => {
    vi.stubGlobal("matchMedia", undefined)
    expect(prefersReducedMotion()).toBe(false)
  })
})
