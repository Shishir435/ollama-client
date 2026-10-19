import type {
  AgentEvidenceRecord,
  AgentObservation,
  AgentRunOutcome,
  AgentTaskConstraint,
  AgentTaskRequirement
} from "@ollama-client/contracts"
import { describe, expect, it } from "vitest"
import {
  type AgentCompletionInput,
  type AgentCompletionJudgement,
  judgeAgentCompletion
} from "../completion"
import {
  agentCompletionNeedsReview,
  agentCompletionReviewRequest,
  agentReviewRecordCitable,
  applyAgentCompletionReview,
  applyAgentReviewDowngrades
} from "../completion-review"
import type { AgentReviewedAction } from "../ports"

const source = {
  tabId: 7,
  frameId: 0,
  documentId: "d1",
  snapshotId: "s1",
  generation: 1,
  origin: "https://example.com"
}

const page: AgentObservation = {
  snapshotId: "s1",
  generation: 1,
  tabId: 7,
  frameId: 0,
  documentId: "d1",
  url: "https://example.com/report",
  origin: "https://example.com",
  title: "Report",
  visibleText: "Quarterly revenue rose to 4.2 million. Help menu expanded",
  frames: [
    {
      frameId: 0,
      documentId: "d1",
      snapshotId: "s1",
      generation: 1,
      origin: "https://example.com",
      url: "https://example.com/report",
      access: "ok"
    }
  ],
  elements: [],
  dialogs: [],
  capturedAt: 1,
  scroll: {
    x: 0,
    y: 0,
    viewportWidth: 100,
    viewportHeight: 100,
    documentWidth: 100,
    documentHeight: 100
  }
}

const record = (
  id: string,
  overrides: Partial<AgentEvidenceRecord> = {}
): AgentEvidenceRecord => ({
  id,
  kind: "observed_fact",
  validity: "current",
  observedAt: 1,
  quote: "Help menu expanded",
  source,
  ...overrides
})

const QUOTE = "Quarterly revenue rose to 4.2 million"

const saved: AgentTaskRequirement = {
  id: "r1",
  kind: "change",
  text: "Invoice 1 is saved"
}
const answered: AgentTaskRequirement = {
  id: "r2",
  kind: "read",
  text: "Report the quarterly revenue"
}

/** A change claim whose quote has provenance but proves nothing: needs review. */
const semanticInput = (
  overrides: Partial<AgentCompletionInput> = {}
): AgentCompletionInput => ({
  steps: [],
  observation: page,
  evidenceLedger: [record("fact-1", { requirementId: "r1" })],
  requirements: [saved],
  outcomes: [{ id: "r1", met: true, evidence: "Help menu expanded" }],
  ...overrides
})

const pending = (input: AgentCompletionInput) => {
  const judgement = judgeAgentCompletion(input)
  if (!agentCompletionNeedsReview(judgement))
    throw new Error(`expected a reviewable refusal, got ${judgement.type}`)
  return judgement
}

const reviewRequest = (
  judgement: ReturnType<typeof pending>,
  input: AgentCompletionInput,
  constraints: AgentTaskConstraint[] = [],
  appliedActions?: AgentReviewedAction[]
) =>
  agentCompletionReviewRequest(
    {
      goal: "Save invoice 1",
      requirements: input.requirements ? [...input.requirements] : undefined,
      constraints
    },
    judgement.review,
    input.outcomes,
    input.evidenceLedger ?? [],
    undefined,
    appliedActions
  )

const settle = (
  input: AgentCompletionInput,
  verdicts: {
    id: string
    verdict: "supported" | "contradicted" | "insufficient_evidence"
    sources?: string[]
  }[],
  constraints: AgentTaskConstraint[] = [],
  appliedActions?: AgentReviewedAction[]
): { judgement: AgentCompletionJudgement; disagreements: number } => {
  const judgement = pending(input)
  return applyAgentCompletionReview(
    judgement,
    reviewRequest(judgement, input, constraints, appliedActions),
    { verdicts: verdicts.map((entry) => ({ sources: [], ...entry })) }
  )
}

describe("completion review scope", () => {
  it("names exactly the requirements no deterministic check could decide", () => {
    const judgement = pending(semanticInput())
    expect(judgement.review).toEqual({
      requirementIds: ["r1"],
      constraintIds: [],
      outcome: { met: [], unmet: [], graded: true }
    })
  })

  it("keeps the deterministic outcome of every other requirement", () => {
    const judgement = pending(
      semanticInput({
        requirements: [saved, { ...answered, id: "r3" }],
        outcomes: [
          { id: "r1", met: true, evidence: "Help menu expanded" },
          { id: "r3", met: false }
        ]
      })
    )
    expect(judgement.review.outcome).toEqual({
      met: [],
      unmet: ["r3"],
      graded: true
    })
  })

  it("puts a limit with no deterministic support in the same scope", () => {
    const limit: AgentTaskConstraint = {
      id: "c1",
      kind: "limit",
      text: "Spend at most 50 dollars"
    }
    const judgement = pending(semanticInput({ constraints: [limit] }))
    expect(judgement.review).toMatchObject({
      requirementIds: ["r1"],
      constraintIds: ["c1"]
    })
  })

  it("never offers a broken limit to review, whatever order it was planned in", () => {
    const judgement = judgeAgentCompletion(
      semanticInput({
        constraints: [
          { id: "c1", kind: "limit", text: "Spend at most 50 dollars" },
          {
            id: "c2",
            kind: "exclude",
            text: "Do not submit",
            forbids: ["submission"]
          }
        ],
        steps: [
          {
            runId: "run",
            stepId: "s1",
            sequence: 1,
            status: "verified",
            at: 1,
            mutating: true,
            consequential: ["submission"],
            verification: {
              outcome: "confirmed",
              evidence: { kind: "submission", summary: "sent", observedAt: 1 }
            }
          }
        ]
      })
    )
    expect(judgement).toMatchObject({ reason: "contradicted_state" })
    expect(agentCompletionNeedsReview(judgement)).toBe(false)
  })

  it("does not offer missing effect evidence to review: reading cannot supply it", () => {
    const judgement = judgeAgentCompletion(
      semanticInput({
        constraints: [
          { id: "c1", kind: "limit", text: "Spend at most 50 dollars" }
        ],
        steps: [
          {
            runId: "run",
            stepId: "s1",
            sequence: 1,
            status: "verified",
            at: 1,
            mutating: true,
            verification: {
              outcome: "confirmed",
              evidence: { kind: "field", summary: "set", observedAt: 1 }
            }
          }
        ]
      })
    )
    expect(judgement).toMatchObject({ reason: "needs_review" })
    expect(agentCompletionNeedsReview(judgement)).toBe(false)
  })

  it("shows the reviewer grounded records only, never the claimant's own words", () => {
    const input = semanticInput({
      evidenceLedger: [
        record("fact-1"),
        record("guess", { kind: "model_inference", source: undefined }),
        record("typed", { kind: "agent_input", source: undefined }),
        record("stale", { validity: "requires_refresh" })
      ]
    })
    const request = reviewRequest(pending(input), input)
    expect(request.evidenceLedger.map((entry) => entry.id)).toEqual(["fact-1"])
    expect(request.requirements.map((entry) => entry.id)).toEqual(["r1"])
    expect(request.claims.map((entry) => entry.id)).toEqual(["r1"])
  })
})

describe("itemized requirements under review", () => {
  it("stays unmet when an item was reported unmet, so no review can complete it", () => {
    const judgement = judgeAgentCompletion(
      semanticInput({
        requirements: [
          {
            id: "r2",
            kind: "read",
            text: "Report these figures",
            items: ["revenue", "costs"]
          }
        ],
        evidenceLedger: [
          record("revenue", { quote: QUOTE, requirementId: "r2" })
        ],
        outcomes: [
          {
            id: "r2",
            met: true,
            items: [
              { index: 0, met: true, evidence: "revenue was $4.2M" },
              { index: 1, met: false }
            ]
          }
        ]
      })
    )
    expect(agentCompletionNeedsReview(judgement)).toBe(false)
    expect(judgement).toEqual({
      type: "unmet",
      outcome: {
        met: [],
        unmet: ["r2"],
        graded: true,
        items: [{ id: "r2", met: [] }]
      }
    })
  })

  it("is never reviewed: one citation cannot say which item it supports", () => {
    const judgement = judgeAgentCompletion(
      semanticInput({
        requirements: [
          {
            id: "r2",
            kind: "read",
            text: "Report these figures",
            items: ["revenue", "costs"]
          }
        ],
        evidenceLedger: [
          record("revenue", { quote: QUOTE, requirementId: "r2" })
        ],
        outcomes: [
          {
            id: "r2",
            met: true,
            items: [
              { index: 0, met: true, evidence: "revenue was $4.2M" },
              { index: 1, met: true, evidence: "costs were flat" }
            ]
          }
        ]
      })
    )
    expect(judgement).toMatchObject({ reason: "needs_review" })
    expect(agentCompletionNeedsReview(judgement)).toBe(false)
  })
})

describe("applying a completion review", () => {
  it("accepts a supported claim backed by a grounded citation", () => {
    expect(
      settle(semanticInput(), [
        { id: "r1", verdict: "supported", sources: ["fact-1"] }
      ])
    ).toEqual({
      disagreements: 0,
      /** A reviewer's verdict reaches supported, never verified. */
      judgement: {
        type: "accepted",
        outcome: { met: ["r1"], unmet: [], graded: true, supported: ["r1"] }
      }
    })
  })

  it("passes a correct paraphrased read answer with source support", () => {
    const input = semanticInput({
      requirements: [answered],
      evidenceLedger: [
        record("revenue", {
          quote: "Quarterly revenue rose to 4.2 million",
          requirementId: "r2"
        })
      ],
      outcomes: [
        { id: "r2", met: true, evidence: "Revenue was $4.2M this quarter" }
      ]
    })
    expect(judgeAgentCompletion(input)).toMatchObject({
      reason: "needs_review",
      review: { requirementIds: ["r2"] }
    })
    expect(
      settle(input, [{ id: "r2", verdict: "supported", sources: ["revenue"] }])
        .judgement
    ).toMatchObject({ type: "accepted", outcome: { met: ["r2"] } })
  })

  it("marks plausible evidence grounded for another requirement as insufficient", () => {
    const input = semanticInput({
      evidenceLedger: [record("other", { requirementId: "r9" })]
    })
    const result = settle(input, [
      { id: "r1", verdict: "supported", sources: ["other"] }
    ])
    expect(result.disagreements).toBe(1)
    expect(result.judgement).toMatchObject({
      type: "refused",
      reason: "needs_review"
    })
  })

  it("still refuses a read when nothing grounded could answer it", () => {
    expect(
      judgeAgentCompletion(
        semanticInput({
          requirements: [answered],
          evidenceLedger: [
            record("guess", { kind: "model_inference", source: undefined })
          ],
          outcomes: [{ id: "r2", met: true, evidence: "Revenue was $4.2M" }]
        })
      )
    ).toMatchObject({ reason: "absent_evidence" })
  })

  it("ignores a citation the runtime never grounded", () => {
    const input = semanticInput({
      evidenceLedger: [
        record("fact-1"),
        record("guess", { kind: "model_inference", source: undefined })
      ]
    })
    expect(
      settle(input, [
        { id: "r1", verdict: "supported", sources: ["guess", "invented"] }
      ]).judgement
    ).toMatchObject({ reason: "needs_review" })
  })

  it("marks only text that appeared after the outcome's own action", () => {
    const input = semanticInput({
      evidenceLedger: [
        record("before", { requirementId: "r1", quote: "Help menu" }),
        record("after", { requirementId: "r1", quote: "Status: Active" }),
        record("later", { requirementId: "r1", quote: "Order placed" }),
        record("other", { requirementId: "r2", quote: "Status: Active" }),
        record("old", {
          requirementId: "r1",
          quote: "Status: Active",
          validity: "historical"
        })
      ]
    })
    const judgement = pending(input)
    const build = (
      windows?: ReadonlyMap<string, { before: string; after?: string }>
    ) =>
      agentCompletionReviewRequest(
        { goal: "Click Continue", requirements: [saved], constraints: [] },
        judgement.review,
        input.outcomes,
        input.evidenceLedger ?? [],
        windows
      ).appearedAfterAction
    /** The window closed at the next change: later text is not this action's. */
    expect(
      build(
        new Map([
          [
            "r1",
            {
              before: "help menu continue",
              after: "help menu status: active"
            }
          ]
        ])
      )
    ).toEqual(["after"])
    /** Still open: everything new since the action is inside it. */
    expect(build(new Map([["r1", { before: "help menu continue" }]]))).toEqual([
      "after",
      "later"
    ])
    /** No window for a requirement, or none in this worker: nothing claimed. */
    expect(build(new Map())).toEqual([])
    expect(build()).toBeUndefined()
  })

  it("names the action each window opened with, from its receipt", () => {
    const input = semanticInput()
    const judgement = pending(input)
    const request = agentCompletionReviewRequest(
      { goal: "Click Continue", requirements: [saved], constraints: [] },
      judgement.review,
      input.outcomes,
      input.evidenceLedger ?? [],
      new Map([
        [
          "r1",
          {
            before: "",
            actions: [{ command: "click", role: "button", name: "Accept" }]
          }
        ],
        ["r9", { before: "", actions: [{ command: "click" }] }]
      ])
    )
    /** Only the reviewed requirements, so the reviewer sees the real control. */
    expect(request.actions).toEqual([
      { requirementId: "r1", command: "click", role: "button", name: "Accept" }
    ])
  })

  it("tells the reviewer exactly what it will accept", () => {
    const requirements = [saved, answered]
    const activation = record("click", {
      kind: "verified_effect",
      validity: "historical",
      quote: undefined,
      verificationKind: "activation",
      requirementId: "r1"
    })
    const field = { ...activation, id: "field", verificationKind: "field" }
    expect(agentReviewRecordCitable(activation, requirements)).toBe(false)
    expect(agentReviewRecordCitable(field, requirements)).toBe(true)
    expect(
      agentReviewRecordCitable(
        record("fact", { requirementId: "r2" }),
        requirements
      )
    ).toBe(true)
    expect(agentReviewRecordCitable(record("loose"), requirements)).toBe(false)
  })

  it("refuses to answer a read with an effect record", () => {
    const input = semanticInput({
      requirements: [answered],
      outcomes: [{ id: "r2", met: true, evidence: "The help menu opened" }],
      evidenceLedger: [record("fact-1", { requirementId: "r2" })]
    })
    const judgement = pending(input)
    const effect = record("effect", {
      kind: "verified_effect",
      quote: undefined,
      verificationKind: "field"
    })
    const request = {
      ...reviewRequest(judgement, input),
      evidenceLedger: [effect]
    }
    expect(
      applyAgentCompletionReview(judgement, request, {
        verdicts: [{ id: "r2", verdict: "supported", sources: ["effect"] }]
      }).judgement
    ).toMatchObject({ reason: "needs_review" })
  })

  it("turns a contradiction into a contradicted state, citations or not", () => {
    expect(
      settle(semanticInput(), [{ id: "r1", verdict: "contradicted" }])
    ).toMatchObject({
      disagreements: 1,
      judgement: { type: "refused", reason: "contradicted_state" }
    })
  })

  it("treats a skipped or doubled answer as insufficient", () => {
    expect(settle(semanticInput(), []).judgement).toMatchObject({
      reason: "needs_review"
    })
    expect(
      settle(semanticInput(), [
        { id: "r1", verdict: "supported", sources: ["fact-1"] },
        { id: "r1", verdict: "supported", sources: ["fact-1"] }
      ]).judgement
    ).toMatchObject({ reason: "needs_review" })
  })

  it("cannot add, settle or rewrite an id it was not asked about", () => {
    const input = semanticInput({
      requirements: [saved, { ...answered, id: "r3" }],
      outcomes: [
        { id: "r1", met: true, evidence: "Help menu expanded" },
        { id: "r3", met: false }
      ]
    })
    expect(
      settle(input, [
        { id: "r1", verdict: "supported", sources: ["fact-1"] },
        { id: "r3", verdict: "supported", sources: ["fact-1"] },
        { id: "r9", verdict: "contradicted" }
      ]).judgement
    ).toEqual({
      type: "partial",
      outcome: { met: ["r1"], unmet: ["r3"], graded: true, supported: ["r1"] }
    })
  })

  it("needs every reviewed limit supported too", () => {
    const limit: AgentTaskConstraint = {
      id: "c1",
      kind: "limit",
      text: "Spend at most 50 dollars"
    }
    const input = semanticInput({
      constraints: [limit],
      evidenceLedger: [
        record("fact-1", { requirementId: "r1" }),
        record("total", { quote: "Total $42.00", requirementId: "c1" })
      ]
    })
    expect(
      settle(
        input,
        [
          { id: "r1", verdict: "supported", sources: ["fact-1"] },
          { id: "c1", verdict: "insufficient_evidence" }
        ],
        [limit]
      ).judgement
    ).toMatchObject({ reason: "needs_review" })
    expect(
      settle(
        input,
        [
          { id: "r1", verdict: "supported", sources: ["fact-1"] },
          { id: "c1", verdict: "supported", sources: ["total"] }
        ],
        [limit]
      ).judgement
    ).toMatchObject({ type: "accepted" })
  })
})

describe("what a citation can support", () => {
  const limit: AgentTaskConstraint = {
    id: "c1",
    kind: "limit",
    text: "Spend at most 50 dollars"
  }

  it("refuses a fact bound to no requirement at all", () => {
    expect(
      settle(semanticInput({ evidenceLedger: [record("loose")] }), [
        { id: "r1", verdict: "supported", sources: ["loose"] }
      ]).judgement
    ).toMatchObject({ reason: "needs_review" })
  })

  it("accepts a change shown by an effect that proves its resulting state", () => {
    const input = semanticInput({
      evidenceLedger: [
        record("fact-1", { requirementId: "r1" }),
        record("field", {
          kind: "verified_effect",
          quote: undefined,
          verificationKind: "field",
          requirementId: "r1"
        })
      ]
    })
    expect(
      settle(input, [{ id: "r1", verdict: "supported", sources: ["field"] }])
        .judgement
    ).toMatchObject({ type: "accepted" })
  })

  it("refuses a change shown only by an activation", () => {
    const input = semanticInput({
      evidenceLedger: [
        record("fact-1", { requirementId: "r1" }),
        record("pressed", {
          kind: "verified_effect",
          quote: undefined,
          verificationKind: "activation",
          requirementId: "r1"
        })
      ]
    })
    expect(
      settle(input, [{ id: "r1", verdict: "supported", sources: ["pressed"] }])
        .judgement
    ).toMatchObject({ reason: "needs_review" })
  })

  it("supports a limit only with a quotation bound to that limit", () => {
    const unrelated = semanticInput({ constraints: [limit] })
    expect(
      settle(
        unrelated,
        [
          { id: "r1", verdict: "supported", sources: ["fact-1"] },
          { id: "c1", verdict: "supported", sources: ["fact-1"] }
        ],
        [limit]
      ).judgement
    ).toMatchObject({ reason: "needs_review" })
    const bound = semanticInput({
      constraints: [limit],
      evidenceLedger: [
        record("fact-1", { requirementId: "r1" }),
        record("total", { quote: "Total $42.00", requirementId: "c1" })
      ]
    })
    expect(
      settle(
        bound,
        [
          { id: "r1", verdict: "supported", sources: ["fact-1"] },
          { id: "c1", verdict: "supported", sources: ["total"] }
        ],
        [limit]
      ).judgement
    ).toMatchObject({ type: "accepted" })
  })

  describe("an exclusion of changes", () => {
    const untouched: AgentTaskConstraint = {
      id: "c1",
      kind: "exclude",
      text: "Don't approve or change anything"
    }
    const read = semanticInput({
      constraints: [untouched],
      requirements: [answered],
      evidenceLedger: [record("fact-1", { requirementId: "r2", quote: QUOTE })],
      outcomes: [{ id: "r2", met: true, evidence: QUOTE }],
      steps: [
        {
          runId: "run",
          stepId: "s1",
          sequence: 1,
          status: "verified",
          at: 1,
          mutating: false,
          verification: {
            outcome: "confirmed",
            evidence: { kind: "navigation", summary: "opened", observedAt: 1 }
          }
        }
      ]
    })
    const changed = (status: "verified" | "uncertain") =>
      semanticInput({
        ...read,
        steps: [
          {
            runId: "run",
            stepId: "s2",
            sequence: 2,
            status,
            at: 2,
            mutating: true,
            consequential: [],
            verification: {
              outcome: "confirmed",
              evidence: { kind: "field", summary: "set", observedAt: 2 }
            }
          }
        ]
      })
    const reviewed = (input: AgentCompletionInput): string[] => {
      const judgement = judgeAgentCompletion(input)
      return agentCompletionNeedsReview(judgement)
        ? judgement.review.constraintIds
        : []
    }

    it("holds on a run that changed nothing", () => {
      expect(reviewed(read)).not.toContain("c1")
    })

    it("goes to review once the run changed something or is unsure", () => {
      expect(reviewed(changed("verified"))).toContain("c1")
      expect(reviewed(changed("uncertain"))).toContain("c1")
    })

    it("goes to review when its forbidden classes cover only part of it", () => {
      const forbidding = { ...untouched, forbids: ["submission" as const] }
      expect(reviewed({ ...read, constraints: [forbidding] })).not.toContain(
        "c1"
      )
      expect(
        reviewed({ ...changed("verified"), constraints: [forbidding] })
      ).toContain("c1")
    })

    it("goes to review when it is about where the run goes", () => {
      const away = { ...untouched, text: "Don't open or change other pages" }
      expect(reviewed({ ...read, constraints: [away] })).toContain("c1")
    })

    const citing = (text: string) => {
      const pressed = record("save", {
        kind: "verified_effect",
        quote: undefined,
        verificationKind: "field",
        requirementId: "r1"
      })
      const input = semanticInput({
        constraints: [{ ...untouched, text }],
        evidenceLedger: [record("fact-1", { requirementId: "r1" }), pressed],
        steps: changed("verified").steps
      })
      expect(pending(input).review.constraintIds).toContain("c1")
      return settle(
        input,
        [
          { id: "r1", verdict: "supported", sources: ["fact-1"] },
          { id: "c1", verdict: "supported", sources: ["save"] }
        ],
        [{ ...untouched, text }],
        [{ requirementId: "r1", command: "click" }]
      ).judgement
    }

    it("lets the reviewer cite the run's own actions for it", () => {
      expect(citing("Don't reorder anything else")).toMatchObject({
        type: "accepted"
      })
    })

    it("needs a bound quotation when it is about the page, not the run's actions", () => {
      expect(citing("No seller outside the EU")).toMatchObject({
        type: "refused",
        reason: "needs_review"
      })
    })
  })

  describe("a limit on how the run acted", () => {
    const method: AgentTaskConstraint = {
      id: "c1",
      kind: "scope",
      text: "Move focus using Tab"
    }
    const pressed = record("tab", {
      kind: "verified_effect",
      quote: undefined,
      verificationKind: "keyboard",
      requirementId: "r1"
    })
    const input = semanticInput({
      constraints: [method],
      evidenceLedger: [record("fact-1", { requirementId: "r1" }), pressed]
    })

    const applied: AgentReviewedAction[] = [
      { requirementId: "r1", command: "press_key", key: "Tab" }
    ]

    it("accepts the run's own confirmed action as support", () => {
      expect(
        settle(
          input,
          [
            { id: "r1", verdict: "supported", sources: ["fact-1"] },
            { id: "c1", verdict: "supported", sources: ["tab"] }
          ],
          [method],
          applied
        ).judgement
      ).toMatchObject({ type: "accepted" })
    })

    it("refuses that support when the run's action list is not complete", () => {
      expect(
        settle(
          input,
          [
            { id: "r1", verdict: "supported", sources: ["fact-1"] },
            { id: "c1", verdict: "supported", sources: ["tab"] }
          ],
          [method]
        ).judgement
      ).toMatchObject({ reason: "needs_review" })
    })

    it("never lets an action stand for an amount the page must show", () => {
      const cap: AgentTaskConstraint = { ...method, kind: "limit" }
      expect(
        settle(
          semanticInput({
            constraints: [cap],
            evidenceLedger: [record("fact-1", { requirementId: "r1" }), pressed]
          }),
          [
            { id: "r1", verdict: "supported", sources: ["fact-1"] },
            { id: "c1", verdict: "supported", sources: ["tab"] }
          ],
          [cap]
        ).judgement
      ).toMatchObject({ reason: "needs_review" })
    })

    it("still refuses a cited model inference", () => {
      const inferred = record("guess", {
        kind: "model_inference",
        requirementId: "r1"
      })
      expect(
        settle(
          semanticInput({
            constraints: [method],
            evidenceLedger: [
              record("fact-1", { requirementId: "r1" }),
              inferred
            ]
          }),
          [
            { id: "r1", verdict: "supported", sources: ["fact-1"] },
            { id: "c1", verdict: "supported", sources: ["guess"] }
          ],
          [method]
        ).judgement
      ).toMatchObject({ reason: "needs_review" })
    })

    it("shows the reviewer every applied action, untagged ones too", () => {
      const judgement = pending(input)
      const untagged: AgentReviewedAction = {
        requirementId: "unbound",
        command: "click",
        name: "Other"
      }
      const request = agentCompletionReviewRequest(
        { goal: "Tab to Second", requirements: [saved], constraints: [method] },
        judgement.review,
        input.outcomes,
        input.evidenceLedger ?? [],
        new Map([
          [
            "r1",
            { before: "", actions: [{ command: "press_key", key: "Tab" }] }
          ]
        ]),
        [...applied, untagged]
      )
      expect(request.actions).toEqual([...applied, untagged])
      expect(request.actionsComplete).toBe(true)
    })
  })
})

describe("a reviewer lowering an outcome the runtime checked", () => {
  const outcome: AgentRunOutcome = {
    met: ["r1", "r2"],
    unmet: [],
    claimed: ["r2"],
    graded: true
  }
  const accepted: AgentCompletionJudgement = { type: "accepted", outcome }
  const ledger = [record("fact-1", { requirementId: "r1" })]
  const request = (scopeOutcome = outcome) =>
    agentCompletionReviewRequest(
      { goal: "Save invoice 1", requirements: [saved, answered] },
      { requirementIds: ["r2"], constraintIds: [], outcome: scopeOutcome },
      [{ id: "r2", met: true, evidence: QUOTE }],
      ledger
    )
  const lower = (
    verdicts: {
      id: string
      verdict: "supported" | "contradicted" | "insufficient_evidence"
      sources?: string[]
    }[],
    built = request()
  ) =>
    applyAgentReviewDowngrades(accepted, built, {
      verdicts: verdicts.map((entry) => ({ sources: [], ...entry }))
    })

  it("shows the reviewer the checked outcomes outside its scope", () => {
    expect(request().checked?.map((requirement) => requirement.id)).toEqual([
      "r1"
    ])
    const { graded: _graded, ...ungraded } = outcome
    expect(request(ungraded).checked).toBeUndefined()
  })

  it("moves a contradicted checked outcome to claimed, never to a refusal", () => {
    const result = lower([
      { id: "r1", verdict: "contradicted", sources: ["fact-1"] }
    ])
    expect(result.downgraded).toEqual(["r1"])
    expect(result.judgement).toEqual({
      type: "accepted",
      outcome: { ...outcome, claimed: ["r2", "r1"] }
    })
  })

  it("lowers a supported outcome as well as a verified one", () => {
    const result = applyAgentReviewDowngrades(
      { type: "accepted", outcome: { ...outcome, supported: ["r1"] } },
      request(),
      {
        verdicts: [{ id: "r1", verdict: "contradicted", sources: ["fact-1"] }]
      }
    )
    expect(
      result.judgement.type === "accepted" && result.judgement.outcome
    ).toEqual({ ...outcome, claimed: ["r2", "r1"] })
  })

  it("needs a cited record and one answer, and never raises an outcome", () => {
    for (const verdicts of [
      [{ id: "r1", verdict: "contradicted" as const }],
      [{ id: "r1", verdict: "contradicted" as const, sources: ["made-up"] }],
      [{ id: "r1", verdict: "supported" as const, sources: ["fact-1"] }],
      [
        { id: "r1", verdict: "contradicted" as const, sources: ["fact-1"] },
        { id: "r1", verdict: "supported" as const, sources: ["fact-1"] }
      ]
    ]) {
      const result = lower(verdicts)
      expect(result.downgraded).toEqual([])
      expect(result.judgement).toBe(accepted)
    }
  })
})
