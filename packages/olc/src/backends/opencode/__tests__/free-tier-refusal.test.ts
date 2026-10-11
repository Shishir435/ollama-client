import { describe, expect, it } from "vitest"
import {
  FREE_TIER_REFUSAL_TYPE,
  freeTierRefusalMessage,
  isFreeTierRefusal
} from "../free-tier-refusal.js"
import type { MessageFailure } from "../turn-events.js"

/**
 * Zen's free-tier gate, as the proxy tells it apart from a backend that is
 * down: the gateway's own `FreeTierError` code inside the provider response
 * body when present, the refusal sentence otherwise.
 */
describe("free-tier refusal", () => {
  it("recognizes the gateway's FreeTierError code in the response body", () => {
    const failure: MessageFailure = {
      name: "APIError",
      message: "Error from provider (Console): something",
      data: {
        message: "Error from provider (Console): something",
        statusCode: 403,
        responseBody:
          '{"type":"error","error":{"type":"FreeTierError","message":"nope"}}'
      }
    }
    expect(isFreeTierRefusal(failure)).toBe(true)
  })

  it("recognizes the refusal sentence without a response body", () => {
    expect(
      isFreeTierRefusal({
        name: "APIError",
        message:
          "Error from provider (Console): OpenCode's free tier can only be used from within OpenCode"
      })
    ).toBe(true)
  })

  it("does not mistake other provider errors for the gate", () => {
    expect(
      isFreeTierRefusal({
        name: "APIError",
        message: "Error from provider (Console): Rate limit exceeded",
        data: {
          message: "Rate limit exceeded",
          statusCode: 429,
          responseBody: '{"type":"error","error":{"type":"RateLimitError"}}'
        }
      })
    ).toBe(false)
    expect(isFreeTierRefusal({})).toBe(false)
  })

  it("names the refused model and the paths that work", () => {
    const message = freeTierRefusalMessage("opencode/big-pickle")
    expect(message).toContain("opencode/big-pickle")
    expect(message).toContain("key-backed provider")
    expect(message).toContain("TUI")
    expect(FREE_TIER_REFUSAL_TYPE).toBe("FreeTierError")
  })
})
