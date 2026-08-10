import { describe, expect, it } from "vitest"
import {
  canTransitionTurnStatus,
  isTerminalTurnStatus,
  RESUMABLE_TURN_STATUSES,
  TERMINAL_TURN_STATUSES,
  TURN_STATUS_PREDECESSORS,
  TURN_STATUSES,
  type TurnStatus
} from "../turns"

describe("turn lifecycle states", () => {
  it("never lets a terminal row move again", () => {
    for (const terminal of TERMINAL_TURN_STATUSES) {
      for (const target of TURN_STATUSES) {
        expect(canTransitionTurnStatus(terminal, target)).toBe(false)
      }
    }
  })

  it("keeps cancellation intent out of restart recovery", () => {
    // The whole point of the state: a restart must not resume it, and must not
    // treat it as settled either.
    expect(RESUMABLE_TURN_STATUSES).not.toContain("cancelling")
    expect(isTerminalTurnStatus("cancelling")).toBe(false)
  })

  it("accepts a stop from every live state", () => {
    for (const live of RESUMABLE_TURN_STATUSES) {
      expect(canTransitionTurnStatus(live, "cancelling")).toBe(true)
    }
  })

  it("lets a cancelling turn settle whichever way it actually ended", () => {
    // The abort races the work it aborts: a generation that finished first
    // still reports completion, and stranding the row would be worse.
    for (const terminal of TERMINAL_TURN_STATUSES) {
      expect(canTransitionTurnStatus("cancelling", terminal)).toBe(true)
    }
  })

  it("refuses to walk the pipeline backwards", () => {
    expect(canTransitionTurnStatus("generating", "building_context")).toBe(
      false
    )
    expect(canTransitionTurnStatus("generating", "submitted")).toBe(false)
    expect(canTransitionTurnStatus("cancelling", "generating")).toBe(false)
  })

  it("treats a repeated in-flight write as legal", () => {
    // Recovery re-claims a turn it already owns; that is not a regression.
    expect(
      canTransitionTurnStatus("building_context", "building_context")
    ).toBe(true)
    expect(canTransitionTurnStatus("generating", "generating")).toBe(true)
  })

  it("keeps submitted unreachable, so a created row cannot be re-created", () => {
    expect(TURN_STATUS_PREDECESSORS.submitted).toHaveLength(0)
    for (const from of TURN_STATUSES as readonly TurnStatus[]) {
      expect(canTransitionTurnStatus(from, "submitted")).toBe(false)
    }
  })
})
