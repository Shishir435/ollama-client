import type { AgentEvidenceRecord } from "@ollama-client/contracts"
import { describe, expect, it } from "vitest"
import {
  agentFollowedLink,
  groundedCompletionQuotes
} from "../completion-support"
import type { AgentEvidenceCode } from "../evidence-code"
import type { AgentStepReadout } from "../ports"

const fact = (
  id: string,
  quote: string,
  tabId: number
): AgentEvidenceRecord => ({
  id,
  kind: "observed_fact",
  validity: "historical",
  observedAt: 1,
  requirementId: "r1",
  quote,
  source: {
    tabId,
    frameId: 0,
    documentId: `document-${tabId}`,
    snapshotId: "snapshot-1",
    generation: 1,
    origin: "https://example.com"
  }
})

describe("groundedCompletionQuotes", () => {
  const ledger = [
    fact("f1", "Offer 1 Reference code: QF-1", 8),
    fact("f2", "Offer 2 Reference code: QF-2", 9)
  ]

  it("grounds one answer joining quotes each retained on its own tab", () => {
    expect(
      groundedCompletionQuotes(
        "Offer 1 Reference code: QF-1; Offer 2 Reference code: QF-2",
        "r1",
        ledger
      ).map((record) => record.id)
    ).toEqual(["f1", "f2"])
  })

  it("grounds nothing when one joined part was never retained", () => {
    expect(
      groundedCompletionQuotes(
        "Offer 1 Reference code: QF-1; Offer 3 Reference code: QF-3",
        "r1",
        ledger
      )
    ).toEqual([])
  })
})

describe("agentFollowedLink", () => {
  const clicked = (
    code: AgentEvidenceCode | undefined,
    summary = "The verifier's own wording, never matched"
  ): AgentStepReadout =>
    ({
      stepId: "run-1:1",
      sequence: 1,
      status: "verified",
      verification: {
        outcome: "confirmed",
        evidence: {
          kind: "activation",
          summary,
          ...(code ? { code } : {}),
          observedAt: 1
        }
      }
    }) as AgentStepReadout

  it("reads the verdict from its code, not from the sentence beside it", () => {
    expect(agentFollowedLink(clicked("destination_committed"))).toBe(true)
    /** A router that moved the tab itself followed the link too. */
    expect(agentFollowedLink(clicked("page_navigated_itself"))).toBe(true)
    expect(agentFollowedLink(clicked("page_handled_link"))).toBe(false)
    expect(agentFollowedLink(clicked(undefined))).toBe(false)
  })

  it("still reads a receipt written before codes existed", () => {
    expect(
      agentFollowedLink(
        clicked(undefined, "Authorized destination is committed")
      )
    ).toBe(true)
    expect(
      agentFollowedLink(clicked(undefined, "Control opened a new tab"))
    ).toBe(true)
  })
})
