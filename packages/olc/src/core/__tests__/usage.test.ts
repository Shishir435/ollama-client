import { describe, expect, it } from "vitest"
import { hasUsage } from "../usage.js"

describe("hasUsage", () => {
  it("treats an all-zero count as nothing to report", () => {
    expect(hasUsage({ promptTokens: 0, completionTokens: 0 })).toBe(false)
    expect(hasUsage({ promptTokens: 1, completionTokens: 0 })).toBe(true)
    expect(hasUsage({ promptTokens: 0, completionTokens: 1 })).toBe(true)
  })
})
