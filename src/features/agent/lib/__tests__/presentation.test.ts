import type { AgentStepRecord } from "@ollama-client/contracts"
import { describe, expect, it } from "vitest"
import {
  AGENT_PAGE_TEXT_LIMIT,
  agentActionLabel,
  agentPlainText,
  currentAgentAction,
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
    expect(log.map((item) => item.label.key)).toEqual([
      "agent.action.replace_text",
      "agent.action.drag"
    ])
    expect(JSON.stringify(log)).not.toContain("secret")
  })

  it("carries page-derived label values flattened, never raw", () => {
    const [item] = toAgentWorkLog([
      {
        runId: "run-1",
        stepId: "s1",
        sequence: 1,
        status: "executing",
        at: 1,
        command: {
          type: "wait",
          condition: "results\nlisted\u0007",
          timeoutMs: 1_000,
          snapshotId: "s",
          generation: 1
        }
      }
    ])
    expect(item.label).toEqual({
      key: "agent.action.wait",
      values: { condition: "results listed" }
    })
  })

  it("names a direction with its own key rather than an English enum", () => {
    expect(
      agentActionLabel({
        type: "scroll",
        direction: "down",
        snapshotId: "s",
        generation: 1
      }).key
    ).toBe("agent.action.scroll_down")
  })

  it("names the action in flight only while its step is unfinished", () => {
    const step = (
      sequence: number,
      status: AgentStepRecord["status"]
    ): AgentStepRecord => ({
      runId: "run-1",
      stepId: `s${sequence}`,
      sequence,
      status,
      at: sequence,
      command: {
        type: "click",
        ref: "e1",
        snapshotId: "s",
        generation: 1
      }
    })

    expect(currentAgentAction([step(1, "executing")])?.key).toBe(
      "agent.action.click"
    )
    /** Verified, failed, rejected and uncertain are all over. */
    for (const status of [
      "verified",
      "failed",
      "rejected",
      "uncertain"
    ] as const) {
      expect(currentAgentAction([step(1, status)])).toBeUndefined()
    }
    /** An unfinished newer step still wins over a settled older one. */
    expect(
      currentAgentAction([step(1, "verified"), step(2, "planned")])?.key
    ).toBe("agent.action.click")
  })
})
