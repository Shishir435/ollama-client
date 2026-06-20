import { beforeEach, describe, expect, it } from "vitest"
import {
  FEATURE_FLAG_DEFAULTS,
  isFeatureEnabled,
  useFeatureFlagsStore
} from "@/stores/feature-flags"

beforeEach(() => {
  useFeatureFlagsStore.getState().reset()
})

describe("feature-flags store", () => {
  it("defaults every flag to false (dark)", () => {
    const { flags } = useFeatureFlagsStore.getState()
    for (const value of Object.values(flags)) {
      expect(value).toBe(false)
    }
    expect(Object.keys(flags).sort()).toEqual(
      Object.keys(FEATURE_FLAG_DEFAULTS).sort()
    )
  })

  it("setFlag enables a single flag without touching others", () => {
    useFeatureFlagsStore.getState().setFlag("screenshotVision", true)
    const { flags } = useFeatureFlagsStore.getState()
    expect(flags.screenshotVision).toBe(true)
    expect(flags.notifications).toBe(false)
  })

  it("isFeatureEnabled reflects the current state non-reactively", () => {
    expect(isFeatureEnabled("omnibox")).toBe(false)
    useFeatureFlagsStore.getState().setFlag("omnibox", true)
    expect(isFeatureEnabled("omnibox")).toBe(true)
  })

  it("reset returns all flags to defaults", () => {
    useFeatureFlagsStore.getState().setFlag("downloads", true)
    useFeatureFlagsStore.getState().reset()
    expect(useFeatureFlagsStore.getState().flags.downloads).toBe(false)
  })
})
