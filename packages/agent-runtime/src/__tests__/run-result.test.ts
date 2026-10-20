import { describe, expect, it } from "vitest"
import { agentRunResult } from "../run-result"

const read = { id: "r1", text: "Report the status code", kind: "read" as const }

describe("agentRunResult", () => {
  it("omits unchecked parent quotes from verified itemized reads", () => {
    const report = agentRunResult(
      "Both invoices paid",
      [{ ...read, items: ["Invoice 1", "Invoice 2"] }],
      [
        {
          id: "r1",
          met: true,
          evidence: "Both invoices paid",
          items: [
            { index: 0, met: true, evidence: "Invoice 1: Draft" },
            { index: 1, met: true, evidence: "Invoice 2: Draft" }
          ]
        }
      ],
      ["r1"]
    )
    expect(report).toBe(
      "Verified: Report the status code\nVerified item: Invoice 1\nInvoice 1: Draft\nVerified item: Invoice 2\nInvoice 2: Draft"
    )
    expect(report).not.toContain("paid")
  })
  it("reports supported items of an incomplete requirement without overstating the rest", () => {
    expect(
      agentRunResult(
        "Found both",
        [{ ...read, items: ["Invoice 1", "Invoice 2"] }],
        [
          {
            id: "r1",
            met: true,
            items: [
              { index: 0, met: true, evidence: "Invoice 1: Draft" },
              { index: 1, met: false }
            ]
          }
        ],
        [],
        { met: [], unmet: ["r1"], items: [{ id: "r1", met: [0] }] }
      )
    ).toBe(
      "Not verified: Report the status code\nVerified item: Invoice 1\nInvoice 1: Draft\nNot verified item: Invoice 2"
    )
  })
  it("reports items the judge supported when the run itself left the requirement unmet", () => {
    expect(
      agentRunResult(
        "Found one",
        [{ ...read, items: ["Invoice 1", "Invoice 2"] }],
        [
          {
            id: "r1",
            met: false,
            items: [
              { index: 0, met: true, evidence: "Invoice 1: Draft" },
              { index: 1, met: false }
            ]
          }
        ],
        [],
        { met: [], unmet: ["r1"], items: [{ id: "r1", met: [0] }] }
      )
    ).toBe(
      "Not verified: Report the status code\nVerified item: Invoice 1\nInvoice 1: Draft\nNot verified item: Invoice 2"
    )
    /** Without a judged item, an unmet requirement lists nothing item by item. */
    expect(
      agentRunResult(
        "Found none",
        [{ ...read, items: ["Invoice 1", "Invoice 2"] }],
        [{ id: "r1", met: false }],
        [],
        { met: [], unmet: ["r1"] }
      )
    ).toBe("Not verified: Report the status code")
  })
  /**
   * gpt-6-luna completed "report the status code" with the summary "Opened
   * Details and found the status code." and the evidence "Status code:
   * ZX-482"; only the summary was kept, and the chat told the user the code
   * was not in the result.
   */
  it("adds what a met read requirement quoted when the summary omits it", () => {
    expect(
      agentRunResult(
        "Opened Details and found the status code.",
        [read],
        [{ id: "r1", met: true, evidence: "Status code: ZX-482" }],
        ["r1"]
      )
    ).toBe("Verified: Report the status code\nStatus code: ZX-482")
  })

  it("keeps the summary alone when it already states the finding", () => {
    expect(
      agentRunResult(
        "The status code is ZX-482.",
        [read],
        [{ id: "r1", met: true, evidence: "ZX-482" }],
        ["r1"]
      )
    ).toBe("Verified: Report the status code\nZX-482")
  })

  it("adds nothing for unmet reads or change requirements", () => {
    const change = { id: "r2", text: "Name is Alice", kind: "change" as const }
    expect(
      agentRunResult(
        "Done.",
        [read, change],
        [
          { id: "r1", met: false, evidence: "Status code: ZX-482" },
          { id: "r2", met: true, evidence: "Alice" }
        ],
        ["r2"]
      )
    ).toBe("Not verified: Report the status code\nVerified: Name is Alice")
  })
})

it("never promotes an unjudged item or a screenshot reading to Verified", () => {
  const requirements = [{ ...read, items: ["Invoice 1", "Invoice 2"] }]
  const outcomes = [
    {
      id: "r1",
      met: true,
      items: [
        { index: 0, met: true, evidence: "Invoice 1 paid" },
        { index: 1, met: true, evidence: "Invoice 2 paid" }
      ]
    }
  ]
  expect(agentRunResult("Both paid", requirements, outcomes, [])).not.toContain(
    "Verified item"
  )
  const report = agentRunResult("Both paid", requirements, outcomes, [], {
    met: [],
    unmet: ["r1"],
    items: [{ id: "r1", met: [0], visual: [0] }]
  })
  expect(report).toContain("Seen in screenshot item: Invoice 1")
  expect(report).toContain("Not verified item: Invoice 2")
})

it("adds the agent's own account, labelled, when what is met is only claimed", () => {
  const requirements = [
    { ...read, text: "Read each shop's price" },
    { id: "r2", text: "Name the cheapest shop", kind: "read" as const }
  ]
  const outcomes = [
    { id: "r1", met: true, evidence: "Blue Kettle 37 credits" },
    { id: "r2", met: true, evidence: "Blue Kettle 37 credits" }
  ]
  const summary = "Brew Bazaar is cheapest at 37 credits."
  expect(
    agentRunResult(summary, requirements, outcomes, ["r1", "r2"], {
      met: ["r1", "r2"],
      unmet: [],
      claimed: ["r2"]
    })
  ).toContain(`Agent's own account, not checked: ${summary}`)
  /** Everything verified: the checked report stands alone. */
  expect(
    agentRunResult(summary, requirements, outcomes, ["r1", "r2"], {
      met: ["r1", "r2"],
      unmet: []
    })
  ).not.toContain("Agent's own account")
  /** Something unmet: an account could contradict it, so none is added. */
  expect(
    agentRunResult(summary, requirements, outcomes, ["r1"], {
      met: ["r1"],
      unmet: ["r2"],
      claimed: ["r1"]
    })
  ).not.toContain("Agent's own account")
})
