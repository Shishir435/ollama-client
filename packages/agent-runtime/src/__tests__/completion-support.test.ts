import type { AgentEvidenceRecord } from "@ollama-client/contracts"
import { describe, expect, it } from "vitest"
import { groundedCompletionQuotes } from "../completion-support"

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
