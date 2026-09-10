import { describe, expect, it } from "vitest"
import {
  AGENT_PAGE_TEXT_LIMIT,
  agentPlainText,
  toAgentWorkLog
} from "../presentation"

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

  it("labels editing and drag steps without echoing what was typed", () => {
    const ground = { snapshotId: "s", generation: 1, ref: "e1" }
    const log = toAgentWorkLog([
      {
        runId: "run-1",
        stepId: "s1",
        sequence: 1,
        status: "executed",
        at: 1,
        command: { type: "replace_text", find: "secret", text: "x", ...ground }
      },
      {
        runId: "run-1",
        stepId: "s2",
        sequence: 2,
        status: "executed",
        at: 2,
        command: { type: "drag", to: "e2", ...ground }
      }
    ])
    expect(log.map((item) => item.label)).toEqual([
      "Edit text in field",
      "Drag control to a drop target"
    ])
    expect(JSON.stringify(log)).not.toContain("secret")
  })
})
