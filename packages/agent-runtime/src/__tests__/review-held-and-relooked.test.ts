import type {
  AgentEvidenceRecord,
  AgentObservation,
  AgentTaskRequirement
} from "@ollama-client/contracts"
import { describe, expect, it } from "vitest"
import type { AgentCompletionReviewScope } from "../completion"
import {
  agentCompletionReviewRequest,
  agentReviewRecordCitable,
  applyAgentCompletionReview
} from "../completion-review"
import { buildAgentEvidenceLedger, groundAgentQuotes } from "../evidence-ledger"
import type { AgentStepReadout } from "../ports"

/**
 * Two live pauses on one two-page form whose second page resets Color to Red
 * and unticks Agree. In one, a batch filed under the Color outcome re-set
 * Color and re-ticked Agree, and the runtime recorded that it held Agree's
 * check too; the reviewer was still given nothing citable for Agree. In the
 * other, the page-2 quote for "review both pages" was lost to read-only
 * re-looks of the unchanged page 2. Each fix is shown with the guards that
 * keep it from proving more than the run did.
 */

const RUN = "run"

const frame = (documentId: string, snapshotId: string, generation: number) => ({
  frameId: 0,
  documentId,
  snapshotId,
  generation,
  origin: "https://example.com",
  url: "https://example.com/application/step/2",
  access: "ok" as const
})

const pageTwo = (
  overrides: Partial<AgentObservation> = {},
  agree = true
): AgentObservation => ({
  snapshotId: "p2-s9",
  generation: 9,
  tabId: 7,
  frameId: 0,
  documentId: "page-2",
  url: "https://example.com/application/step/2",
  origin: "https://example.com",
  title: "Qualification application",
  documentHeading: "Application for Record 8, page 2",
  frames: [frame("page-2", "p2-s9", 9)],
  elements: [
    {
      ref: "e1",
      frameId: 0,
      tag: "input",
      name: "Name",
      value: "Ada",
      visible: true,
      enabled: true,
      editable: true,
      sensitive: false
    },
    {
      ref: "e2",
      frameId: 0,
      tag: "select",
      name: "Color",
      value: "Blue",
      options: [
        { value: "Red", label: "Red", disabled: false },
        { value: "Blue", label: "Blue", disabled: false }
      ],
      visible: true,
      enabled: true,
      editable: true,
      sensitive: false
    },
    {
      ref: "e3",
      frameId: 0,
      tag: "input",
      name: "Agree",
      checked: agree,
      visible: true,
      enabled: true,
      editable: true,
      sensitive: false
    }
  ],
  visibleText:
    "Application for Record 8, page 2 Name Color Agree Submit application",
  dialogs: [],
  capturedAt: 50,
  scroll: {
    x: 0,
    y: 0,
    viewportWidth: 800,
    viewportHeight: 600,
    documentWidth: 800,
    documentHeight: 600
  },
  ...overrides
})

describe("a batch receipt that held another outcome's check", () => {
  const color: AgentTaskRequirement = {
    id: "r2",
    kind: "change",
    text: "Complete the application for Record 8 with Color Blue.",
    check: { type: "field", name: "Color", record: "Record 8", value: "Blue" }
  }
  const agree: AgentTaskRequirement = {
    id: "r3",
    kind: "change",
    text: "Complete the application for Record 8 with Agree checked.",
    check: { type: "checked", name: "Agree", record: "Record 8", checked: true }
  }
  const requirements = [color, agree]

  /** The page-2 batch: filed under Color, verified holding Agree as well. */
  const batch = (
    overrides: Partial<AgentStepReadout> = {}
  ): AgentStepReadout => ({
    runId: RUN,
    stepId: `${RUN}:4`,
    sequence: 4,
    status: "verified",
    at: 40,
    requirementId: "r2",
    mutating: true,
    heldPlannedValue: true,
    heldPlannedFor: ["r3"],
    command: {
      type: "fill_form",
      snapshotId: "p2-s8",
      generation: 8,
      fields: [
        { type: "select", ref: "e2", value: "Blue" },
        { type: "check", ref: "e3" }
      ]
    },
    verification: {
      outcome: "confirmed",
      evidence: {
        kind: "fields",
        observedAt: 40,
        summary: "All 2 fields hold the resolved value",
        fields: [{ name: "Color" }, { name: "Agree" }]
      }
    },
    ...overrides
  })
  const receipt: AgentEvidenceRecord = {
    id: `${RUN}:4:effect`,
    kind: "verified_effect",
    validity: "historical",
    source: {
      tabId: 7,
      frameId: 0,
      documentId: "page-2",
      snapshotId: "p2-s8",
      generation: 8,
      origin: "https://example.com"
    },
    observedAt: 40,
    requirementId: "r2",
    verificationKind: "fields"
  }
  const scope: AgentCompletionReviewScope = {
    requirementIds: ["r3"],
    constraintIds: [],
    outcome: { met: ["r2"], unmet: [] }
  }
  const request = (
    steps: AgentStepReadout[],
    observation: AgentObservation = pageTwo()
  ) =>
    agentCompletionReviewRequest(
      { goal: "Complete the application for Record 8", requirements },
      scope,
      [{ id: "r3", met: true }],
      [receipt],
      undefined,
      undefined,
      observation,
      steps
    )
  const settle = (
    steps: AgentStepReadout[],
    observation?: AgentObservation
  ) => {
    const built = request(steps, observation)
    return applyAgentCompletionReview(
      {
        type: "refused",
        reason: "needs_review",
        feedback: "review",
        review: scope
      },
      built,
      {
        verdicts: [
          {
            id: "r3",
            verdict: "supported",
            sources: built.evidenceLedger.map((record) => record.id)
          }
        ]
      }
    ).judgement
  }

  it("is citable for the outcome whose check it held, while the page holds it", () => {
    const built = request([batch()])
    const copy = built.evidenceLedger.find(
      (record) => record.id === `${RUN}:4:effect~r3`
    )
    expect(copy).toMatchObject({
      requirementId: "r3",
      verificationKind: "fields"
    })
    expect(agentReviewRecordCitable(copy!, built.requirements)).toBe(true)
    expect(settle([batch()])).toMatchObject({
      type: "accepted",
      outcome: { met: ["r2", "r3"], supported: ["r3"] }
    })
  })

  const submitted: AgentStepReadout = {
    runId: RUN,
    stepId: `${RUN}:5`,
    sequence: 5,
    status: "verified",
    at: 50,
    requirementId: "r5",
    mutating: true,
    consequential: ["submission"],
    sourceUrl: "https://example.com/application/step/2",
    command: {
      type: "click",
      ref: "submit",
      snapshotId: "p2-s9",
      generation: 9
    },
    target: { name: "Submit application", tag: "button" },
    verification: {
      outcome: "confirmed",
      evidence: {
        kind: "submission",
        acceptance: "accepted",
        summary: "Form committed",
        observedAt: 50
      }
    }
  }
  const resultPage = () =>
    pageTwo({
      documentId: "result",
      url: "https://example.com/application/result",
      documentHeading: "Record 8",
      visibleText: "Record 8 Saved",
      elements: []
    })
  const filled = () =>
    batch({ sourceUrl: "https://example.com/application/step/2" })

  it("keeps the historical field receipt citable after a commit removes the form", () => {
    const built = request([filled(), submitted], resultPage())
    expect(
      built.evidenceLedger.find((r) => r.id.endsWith("~r3"))
    ).toMatchObject({ validity: "historical", requirementId: "r3" })
    expect(settle([filled(), submitted], resultPage()).type).toBe("accepted")
    // The copy is field evidence only; it never proves the submission outcome.
    expect(built.evidenceLedger.some((r) => r.requirementId === "r5")).toBe(
      false
    )
  })

  it.each(["link", "uncertain", "wrong_record", "partial", "no_commit"])(
    "does not carry field support through %s",
    (reason) => {
      const after = resultPage()
      let send = submitted
      if (reason === "link")
        send = {
          ...submitted,
          consequential: [],
          target: { name: "Result", tag: "a", role: "link" },
          verification: {
            outcome: "confirmed",
            evidence: {
              kind: "navigation",
              summary: "Navigated",
              observedAt: 50
            }
          }
        }
      if (reason === "uncertain")
        send = {
          ...submitted,
          status: "uncertain",
          verification: {
            outcome: "ambiguous",
            evidence: {
              kind: "submission",
              acceptance: "dispatched",
              summary: "Unknown",
              observedAt: 50
            }
          }
        }
      if (reason === "wrong_record") after.documentHeading = "Record 9"
      if (reason === "partial") after.elementsPartial = true
      expect(
        request(
          reason === "no_commit" ? [filled()] : [filled(), send],
          after
        ).evidenceLedger.some((r) => r.id.endsWith("~r3"))
      ).toBe(false)
    }
  )

  it("stays the filed outcome's alone when the batch did not hold the check", () => {
    const unheld = batch({ heldPlannedFor: undefined })
    expect(request([unheld]).evidenceLedger.map((record) => record.id)).toEqual(
      [`${RUN}:4:effect`]
    )
    expect(settle([unheld])).toMatchObject({ type: "refused" })
  })

  it("is not bound once the page reset the box after the write", () => {
    expect(settle([batch()], pageTwo({}, false))).toMatchObject({
      type: "refused"
    })
  })

  it("is not bound on another record's form", () => {
    const other = pageTwo({
      documentHeading: "Application for Record 9, page 2",
      visibleText:
        "Application for Record 9, page 2 Name Color Agree Submit application"
    })
    expect(settle([batch()], other)).toMatchObject({ type: "refused" })
  })

  it("is not bound when the outcome's own later write has an unknown effect", () => {
    const later: AgentStepReadout = {
      runId: RUN,
      stepId: `${RUN}:5`,
      sequence: 5,
      status: "uncertain",
      at: 50,
      requirementId: "r3",
      mutating: true,
      command: {
        type: "uncheck",
        snapshotId: "p2-s9",
        generation: 9,
        ref: "e3"
      }
    }
    expect(settle([batch(), later])).toMatchObject({ type: "refused" })
  })

  it("is not bound when the batch's own verification was not confirmed", () => {
    const unconfirmed = batch({
      verification: {
        outcome: "ambiguous",
        evidence: {
          kind: "fields",
          observedAt: 40,
          summary: "unknown",
          fields: [{ name: "Color" }, { name: "Agree" }]
        }
      }
    })
    expect(settle([unconfirmed])).toMatchObject({ type: "refused" })
  })
})

describe("a page read retained before read-only re-looks of the same page", () => {
  const review: AgentTaskRequirement = {
    id: "r4",
    kind: "read",
    text: "Review both pages of the application for Record 8."
  }
  const state = {
    version: 1 as const,
    id: RUN,
    goal: "Review both pages of the application for Record 8",
    status: "deciding" as const,
    stepCount: 0,
    observationCount: 1,
    controlledTabId: 7,
    providerId: "provider",
    modelId: "model",
    allowedOrigins: ["https://example.com"],
    createdAt: 1,
    updatedAt: 1,
    requirements: [review]
  }
  const QUOTE =
    "Application for Record 8, page 2 Name Color Agree Submit application"
  const read = pageTwo({
    snapshotId: "p2-s14",
    generation: 14,
    frames: [frame("page-2", "p2-s14", 14)]
  })
  const retained = groundAgentQuotes(
    state,
    read,
    [{ quote: QUOTE, requirementId: "r4" }],
    [],
    `${RUN}:6`
  )
  const stepsWith = (records: AgentEvidenceRecord[]): AgentStepReadout[] => [
    {
      runId: RUN,
      stepId: `${RUN}:6`,
      sequence: 6,
      status: "verified",
      at: 60,
      command: {
        type: "extract_text",
        snapshotId: "p2-s14",
        generation: 14,
        offset: 0
      },
      evidenceLedger: records
    }
  ]
  const relooked = pageTwo({
    snapshotId: "p2-s18",
    generation: 18,
    frames: [frame("page-2", "p2-s18", 18)]
  })

  it("stays citable while the open page still says it", () => {
    expect(retained).toHaveLength(1)
    const ledger = buildAgentEvidenceLedger(
      stepsWith(retained),
      state.allowedOrigins,
      relooked
    )
    expect(ledger[0]).toMatchObject({ validity: "current", quote: QUOTE })
    expect(agentReviewRecordCitable(ledger[0], [review])).toBe(true)
  })

  it("is not citable once the open page no longer says it", () => {
    const changed = pageTwo({
      snapshotId: "p2-s18",
      generation: 18,
      frames: [frame("page-2", "p2-s18", 18)],
      visibleText: "Application for Record 8, page 2 Saved"
    })
    const ledger = buildAgentEvidenceLedger(
      stepsWith(retained),
      state.allowedOrigins,
      changed
    )
    expect(ledger[0].validity).toBe("requires_refresh")
    const request = agentCompletionReviewRequest(
      { goal: state.goal, requirements: [review] },
      {
        requirementIds: ["r4"],
        constraintIds: [],
        outcome: { met: [], unmet: [] }
      },
      [{ id: "r4", met: true, evidence: QUOTE }],
      ledger,
      undefined,
      undefined,
      changed,
      stepsWith(retained)
    )
    expect(request.evidenceLedger).toHaveLength(0)
  })

  it("never re-grounds a quote from the other page's document", () => {
    const pageOne = pageTwo({
      documentId: "page-1",
      snapshotId: "p1-s20",
      generation: 20,
      frames: [frame("page-1", "p1-s20", 20)],
      documentHeading: "Application for Record 8, page 1",
      visibleText: QUOTE
    })
    expect(
      buildAgentEvidenceLedger(
        stepsWith(retained),
        state.allowedOrigins,
        pageOne
      )[0].validity
    ).toBe("historical")
  })
})

describe("the full action list a limit is reviewed against", () => {
  const name: AgentTaskRequirement = {
    id: "r1",
    kind: "change",
    text: "Set Name to Ada in the application for Record 8.",
    check: { type: "field", name: "Name", record: "Record 8", value: "Ada" }
  }
  const draft = {
    id: "c2",
    kind: "scope" as const,
    text: "Leave the application as a draft.",
    keep: "draft"
  }
  const request = (
    applied: Parameters<typeof agentCompletionReviewRequest>[5],
    windows: Parameters<typeof agentCompletionReviewRequest>[4]
  ) =>
    agentCompletionReviewRequest(
      {
        goal: "Complete the application for Record 8 as a draft",
        requirements: [name],
        constraints: [draft]
      },
      {
        requirementIds: ["r1"],
        constraintIds: ["c2"],
        outcome: { met: [], unmet: [] }
      },
      [{ id: "r1", met: true }],
      [],
      windows,
      applied,
      pageTwo(),
      []
    )

  it("keeps the values each confirmed write left, from its own outcome's window", () => {
    const built = request(
      [
        {
          stepId: "s1",
          requirementId: "r1",
          command: "fill_form",
          name: "Name"
        },
        { requirementId: "r4", command: "click", name: "Next" }
      ],
      new Map([
        [
          "r1",
          {
            before: "",
            actions: [
              {
                stepId: "s1",
                command: "fill_form",
                name: "Name",
                values: [{ name: "Name", value: "Ada" }]
              }
            ]
          }
        ]
      ])
    )
    expect(built.actionsComplete).toBe(true)
    expect(built.actions).toEqual([
      {
        requirementId: "r1",
        command: "fill_form",
        name: "Name",
        values: [{ name: "Name", value: "Ada" }]
      },
      { requirementId: "r4", command: "click", name: "Next" }
    ])
  })

  it("never shows an older write of the same control the newer write's value", () => {
    const built = request(
      [
        {
          stepId: "s1",
          requirementId: "r1",
          command: "clear_and_type",
          name: "Name"
        },
        {
          stepId: "s2",
          requirementId: "r1",
          command: "clear_and_type",
          name: "Name"
        }
      ],
      new Map([
        [
          "r1",
          {
            before: "",
            actions: [
              {
                stepId: "s2",
                command: "clear_and_type",
                name: "Name",
                values: [{ name: "Name", value: "Ada" }]
              }
            ]
          }
        ]
      ])
    )
    expect(built.actions?.map((action) => action.values)).toEqual([
      undefined,
      [{ name: "Name", value: "Ada" }]
    ])
  })

  it("adds no values a window does not hold for that outcome", () => {
    const built = request(
      [{ requirementId: "r2", command: "fill_form", name: "Name" }],
      new Map([
        [
          "r1",
          {
            before: "",
            actions: [
              {
                stepId: "s1",
                command: "fill_form",
                name: "Name",
                values: [{ name: "Name", value: "Ada" }]
              }
            ]
          }
        ]
      ])
    )
    expect(built.actions?.[0]?.values).toBeUndefined()
  })

  it("never lends an earlier confirmed value to a later unmatched write", () => {
    const built = request(
      [
        {
          stepId: "confirmed",
          requirementId: "r1",
          command: "clear_and_type",
          name: "Name"
        },
        {
          stepId: "uncertain",
          requirementId: "r1",
          command: "clear_and_type",
          name: "Name"
        }
      ],
      new Map([
        [
          "r1",
          {
            before: "",
            actions: [
              {
                stepId: "confirmed",
                command: "clear_and_type",
                name: "Name",
                values: [{ name: "Name", value: "Ada" }]
              }
            ]
          }
        ]
      ])
    )
    expect(built.actions?.map((action) => action.values)).toEqual([
      [{ name: "Name", value: "Ada" }],
      undefined
    ])
    expect(built.actions?.every((action) => action.stepId === undefined)).toBe(
      true
    )
  })
})

describe("read-only answer context when only constraints remain under review", () => {
  const read: AgentTaskRequirement = {
    id: "r1",
    kind: "read",
    text: "Compare every offer and report the cheapest eligible one."
  }
  const claim = {
    id: "r1",
    met: true,
    evidence: "Offer 1 costs 40 credits and is eligible."
  }
  const scope: AgentCompletionReviewScope = {
    requirementIds: [],
    constraintIds: ["c1"],
    outcome: { met: ["r1"], unmet: [], graded: true, supported: ["r1"] }
  }
  const fact: AgentEvidenceRecord = {
    id: "offer",
    kind: "observed_fact",
    validity: "historical",
    quote: claim.evidence,
    requirementId: "r1",
    observedAt: 40,
    source: {
      tabId: 7,
      frameId: 0,
      documentId: "offer",
      snapshotId: "o1",
      generation: 1,
      origin: "https://example.com"
    }
  }
  const state = {
    goal: "Compare offers, exclude Archive",
    requirements: [read],
    constraints: [
      { id: "c1", kind: "exclude" as const, text: "Exclude Archive." }
    ]
  }
  const build = (evidence = [fact], requirements = [read]) =>
    agentCompletionReviewRequest(
      { ...state, requirements },
      scope,
      [claim],
      evidence,
      undefined,
      undefined,
      pageTwo(),
      [],
      "Offer 1 is cheapest at 40 credits. Archive excluded."
    )
  it("retains the chosen answer and checked read claims without reopening their verdicts", () => {
    const built = build()
    expect(built.requirements).toEqual([])
    expect(built.checked?.map((r) => r.id)).toEqual(["r1"])
    expect(built.claims).toEqual([claim])
    expect(built.proposedAnswer).toContain("Offer 1 is cheapest")
    const result = applyAgentCompletionReview(
      {
        type: "refused",
        reason: "needs_review",
        feedback: "Review",
        review: scope
      },
      built,
      { verdicts: [{ id: "c1", verdict: "supported", sources: ["offer"] }] }
    )
    expect(result.judgement.type).toBe("accepted")
  })
  it("rejects an exclusion verdict whose proposed answer picks the excluded subject", () => {
    const pending = {
      type: "refused" as const,
      reason: "needs_review" as const,
      feedback: "Review",
      review: scope
    }
    const verdict = {
      verdicts: [
        { id: "c1", verdict: "supported" as const, sources: ["offer"] }
      ]
    }
    for (const answer of [
      "Archive is cheapest at 30 credits.",
      "The cheapest eligible offer is Archive",
      // Exclusion wording about something else does not leave Archive out.
      "Archive is cheapest, not Offer 1.",
      "Archive is not excluded and is the cheapest offer.",
      "Archive is the best choice and Offer 1 was excluded.",
      "I recommend Archive without hesitation; Offer 1 costs 40 credits."
    ]) {
      const built = {
        ...build(),
        proposedAnswer: answer
      }
      expect(
        applyAgentCompletionReview(pending, built, verdict).judgement.type
      ).toBe("refused")
    }
    // Facts all about the excluded subject cannot show what was chosen instead.
    const archive = {
      ...fact,
      id: "archive",
      quote: "Archive costs 30 credits."
    }
    expect(
      applyAgentCompletionReview(pending, build([fact, archive]), {
        verdicts: [{ id: "c1", verdict: "supported", sources: ["archive"] }]
      }).judgement.type
    ).toBe("refused")
    // Saying the excluded subject was left out keeps the exclusion.
    expect(
      applyAgentCompletionReview(
        pending,
        {
          ...build(),
          proposedAnswer: "Offer 1 is cheapest. Archive was not considered."
        },
        verdict
      ).judgement.type
    ).toBe("accepted")
    /**
     * A neutral fact about the excluded subject, or a pick that says of the
     * subject itself that it was left out, chooses nothing excluded.
     */
    for (const answer of [
      "Archive costs 30 credits. It was excluded. Offer 1 is the cheapest eligible choice.",
      "The cheapest offer, excluding Archive, is Offer 1 at 40 credits.",
      "Archive would be cheapest, but it was excluded; Offer 1 is the pick.",
      "Archive is not the cheapest eligible offer. Offer 1 is."
    ])
      expect(
        applyAgentCompletionReview(
          pending,
          { ...build(), proposedAnswer: answer },
          verdict
        ).judgement.type
      ).toBe("accepted")
    // A neutral mention still needs a cited fact beyond the excluded subject.
    expect(
      applyAgentCompletionReview(
        pending,
        {
          ...build([fact, archive]),
          proposedAnswer: "Archive costs 30 credits. Offer 1 is cheapest."
        },
        { verdicts: [{ id: "c1", verdict: "supported", sources: ["archive"] }] }
      ).judgement.type
    ).toBe("refused")
  })
  it("never uses the proposed answer as evidence when no fact supports it", () => {
    const built = build([])
    const result = applyAgentCompletionReview(
      {
        type: "refused",
        reason: "needs_review",
        feedback: "Review",
        review: scope
      },
      built,
      { verdicts: [{ id: "c1", verdict: "supported", sources: ["offer"] }] }
    )
    expect(result.judgement.type).toBe("refused")
  })
  it("does not expose a change summary as read-only answer support", () => {
    const built = build(
      [fact],
      [read, { id: "r2", kind: "change", text: "Save a record." }]
    )
    expect(built.proposedAnswer).toBeUndefined()
    expect(built.answerIds).toBeUndefined()
    expect(built.claims).toEqual([])
  })
})
