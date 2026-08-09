import { describe, expect, it } from "vitest"
import { isRetryableProviderStatus, parseRetryAfter } from "../retry"

describe("parseRetryAfter", () => {
  it("parses seconds and HTTP dates", () => {
    expect(parseRetryAfter("1.5")).toBe(1500)
    expect(parseRetryAfter("Thu, 01 Jan 2026 00:00:02 GMT", 0)).toBe(
      Date.parse("Thu, 01 Jan 2026 00:00:02 GMT")
    )
  })

  it("rejects malformed and negative values", () => {
    expect(parseRetryAfter("invalid")).toBeUndefined()
    expect(parseRetryAfter("-1")).toBeUndefined()
    expect(parseRetryAfter(null)).toBeUndefined()
  })
})

describe("isRetryableProviderStatus", () => {
  it("classifies transient provider statuses", () => {
    for (const status of [408, 429, 500, 503, 529]) {
      expect(isRetryableProviderStatus(status)).toBe(true)
    }
    for (const status of [400, 401, 403, 404, 422]) {
      expect(isRetryableProviderStatus(status)).toBe(false)
    }
  })
})
