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

  it("carries the control acted on and the model's own note", () => {
    /*
     * Both were durable and neither was rendered, so twenty steps of a real
     * run read as twenty repetitions of "Click control" — the run's own
     * account of what it was doing existed and nobody could see it.
     */
    const [row] = toAgentWorkLog([
      {
        runId: "run-1",
        stepId: "s1",
        sequence: 1,
        status: "verified",
        at: 1,
        command: {
          type: "click",
          snapshotId: "s",
          generation: 1,
          ref: "e7"
        },
        target: {
          ref: "e7",
          tag: "a",
          role: "link",
          name: "Install\nextension"
        },
        finding: "The download is on the store page, not here."
      }
    ])

    expect(row?.label.key).toBe("agent.action.click")
    expect(row?.target).toBe("Install extension")
    expect(row?.note).toBe("The download is on the store page, not here.")
  })

  describe("timeline rows", () => {
    const click = {
      type: "click",
      snapshotId: "s",
      generation: 1,
      ref: "e7"
    } as const
    const step = (patch: Partial<AgentStepRecord>): AgentStepRecord => ({
      runId: "run-1",
      stepId: "s1",
      sequence: 1,
      status: "verified",
      at: 14_500,
      command: click,
      ...patch
    })

    it("names which row a repeated control sat in", () => {
      const [row] = toAgentWorkLog([
        step({ target: { name: "Delete", rowContext: "old.pdf Delete" } })
      ])
      expect(row?.target).toBe("Delete")
      expect(row?.row).toBe("old.pdf")
    })

    it("times a settled step from its first receipt to its last", () => {
      const [row] = toAgentWorkLog([step({ startedAt: 2_000 })])
      expect(row?.durationMs).toBe(12_500)
    })

    it("gives a step still running no duration", () => {
      const [row] = toAgentWorkLog([
        step({ status: "executing", startedAt: 2_000 })
      ])
      expect(row?.durationMs).toBeUndefined()
    })

    /**
     * A click that raised `confirm()` verifies, but "Verified" beside a
     * Delete whose confirmation is still open says the file is gone.
     */
    it("says a dialog opened rather than that the step verified", () => {
      const [row] = toAgentWorkLog([
        step({
          verification: {
            outcome: "confirmed",
            evidence: {
              kind: "native_dialog",
              summary: "A confirm dialog is open",
              observedAt: 14_500
            }
          }
        })
      ])
      expect(row?.status).toBe("dialog_opened")
    })

    it("keeps reasoning's paragraphs and drops control characters", () => {
      const [row] = toAgentWorkLog([
        step({ thinking: "First\u0007 look.\n\n\n\nThen click." })
      ])
      expect(row?.thinking).toBe("First  look.\n\nThen click.")
    })
  })

  it("shows one row per step, at the point that step reached", () => {
    const ground = { snapshotId: "s", generation: 1, ref: "e7" }
    const click = { type: "click", ...ground } as const
    /**
     * The receipts a single approved click leaves behind. Rendering each of
     * them showed "Click control" four times for one thing the run did.
     */
    const log = toAgentWorkLog([
      {
        runId: "run-1",
        stepId: "s1",
        sequence: 503,
        status: "planned",
        at: 1,
        command: click
      },
      {
        runId: "run-1",
        stepId: "s1",
        sequence: 504,
        status: "approved",
        at: 2,
        command: click
      },
      {
        runId: "run-1",
        stepId: "s1",
        sequence: 505,
        status: "executing",
        at: 3,
        command: click
      },
      {
        runId: "run-1",
        stepId: "s1",
        sequence: 506,
        status: "uncertain",
        at: 4,
        command: click,
        verification: {
          outcome: "ambiguous",
          evidence: {
            kind: "worker_termination",
            summary: "The browser effect may have occurred before recovery.",
            observedAt: 4
          }
        }
      }
    ])

    expect(log).toHaveLength(1)
    expect(log[0].status).toBe("uncertain")
    expect(log[0].detail).toBeUndefined()
    expect(log[0].detailLabel?.key).toBe("agent.step_status.uncertain")
  })

  it("keeps model-facing refusal feedback out of the work log", () => {
    const [row] = toAgentWorkLog([
      {
        runId: "run-1",
        stepId: "s1",
        sequence: 1,
        status: "rejected",
        at: 1,
        verification: {
          outcome: "negative",
          evidence: {
            kind: "completion",
            summary: "Copy ONLY an exact phrase from observation text",
            observedAt: 1
          }
        }
      }
    ])
    expect(row.detail).toBeUndefined()
    expect(row.detailLabel?.key).toBe("agent.work_log.action_needs_review")
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
