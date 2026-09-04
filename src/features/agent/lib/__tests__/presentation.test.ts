import { describe, expect, it } from "vitest"
import { AGENT_PAGE_TEXT_LIMIT, agentPlainText } from "../presentation"

describe("Agent presentation", () => {
  it("flattens page-controlled multiline text and applies its cap", () => {
    const value = `Approve now\n<button>Fake control</button>${"x".repeat(400)}`
    const result = agentPlainText(value, AGENT_PAGE_TEXT_LIMIT)

    expect(result).not.toContain("\n")
    expect(result.length).toBeLessThanOrEqual(AGENT_PAGE_TEXT_LIMIT)
    expect(result.endsWith("…")).toBe(true)
  })

  it("removes control characters", () => {
    expect(agentPlainText("safe\u0000\u0007 label", 100)).toBe("safe label")
  })
})
