import { AGENT_RUN_STATUSES } from "@ollama-client/contracts"
import { describe, expect, it } from "vitest"
import {
  AGENT_STATUS_PREDECESSORS,
  isLegalAgentTransition,
  isTerminalAgentStatus
} from "../state"

describe("AGENT_STATUS_PREDECESSORS", () => {
  it("accepts every declared legal transition", () => {
    for (const to of AGENT_RUN_STATUSES) {
      for (const from of AGENT_STATUS_PREDECESSORS[to]) {
        expect(isLegalAgentTransition(from, to)).toBe(true)
      }
    }
  })

  it("rejects transitions from terminal states", () => {
    for (const from of ["completed", "failed", "cancelled"] as const) {
      expect(isTerminalAgentStatus(from)).toBe(true)
      for (const to of AGENT_RUN_STATUSES) {
        expect(isLegalAgentTransition(from, to)).toBe(false)
      }
    }
  })

  it("does not represent uncertainty as a run status", () => {
    expect(AGENT_RUN_STATUSES).not.toContain("uncertain")
  })

  it("requires awaiting_takeover before takeover completion", () => {
    expect(isLegalAgentTransition("awaiting_takeover", "observing")).toBe(true)
    expect(isLegalAgentTransition("deciding", "observing")).toBe(false)
  })

  it("does not permit executing directly from deciding", () => {
    expect(isLegalAgentTransition("deciding", "executing")).toBe(false)
  })
})
