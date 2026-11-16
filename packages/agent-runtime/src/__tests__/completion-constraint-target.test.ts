import type {
  AgentObservation,
  AgentTaskConstraint,
  AgentTaskRequirement
} from "@ollama-client/contracts"
import { describe, expect, it } from "vitest"
import { judgeAgentCompletion } from "../completion"
import type { AgentStepReadout } from "../ports"

const observation = (
  overrides: Partial<AgentObservation> = {}
): AgentObservation => ({
  snapshotId: "snapshot-1",
  generation: 1,
  tabId: 7,
  frameId: 0,
  documentId: "document-1",
  url: "https://example.com/doc",
  origin: "https://example.com",
  title: "Untitled document",
  frames: [
    {
      frameId: 0,
      documentId: "document-1",
      origin: "https://example.com",
      url: "https://example.com/doc",
      access: "ok",
      snapshotId: "snapshot-1",
      generation: 1
    }
  ],
  elements: [],
  visibleText: "Edit your document",
  scroll: {
    x: 0,
    y: 0,
    viewportWidth: 100,
    viewportHeight: 100,
    documentWidth: 100,
    documentHeight: 100
  },
  dialogs: [],
  capturedAt: 1,
  ...overrides
})

const step = (
  overrides: Partial<AgentStepReadout> & { sequence: number }
): AgentStepReadout => ({
  runId: "run-1",
  stepId: `run-1:${overrides.sequence}`,
  status: "verified",
  at: overrides.sequence,
  command: {
    type: "click",
    ref: "e1",
    snapshotId: "snapshot-1",
    generation: 1
  },
  mutating: true,
  verification: {
    outcome: "confirmed",
    evidence: { kind: "activation", summary: "Page changed", observedAt: 1 }
  },
  ...overrides
})

const deleteB: AgentTaskRequirement = {
  id: "r1",
  text: "Invoice B is deleted",
  kind: "change"
}

/** The delete click, planned with its check result and then verified. */
const deleted = (held?: string[]): AgentStepReadout[] => [
  step({
    sequence: 1,
    status: "planned",
    stepId: "run-1:1",
    requirementId: "r1",
    ...(held ? { constraintsHeld: held } : {})
  }),
  step({
    sequence: 2,
    stepId: "run-1:1",
    requirementId: "r1",
    consequential: ["destructive"],
    target: { name: "Delete", rowContext: "Invoice B Delete" }
  })
]

const judged = (
  constraints: AgentTaskConstraint[],
  steps: AgentStepReadout[],
  requirements: AgentTaskRequirement[] = [deleteB]
) =>
  judgeAgentCompletion({
    steps,
    observation: observation({ visibleText: "Invoice B deleted" }),
    requirements,
    constraints,
    outcomes: requirements.map((requirement) => ({
      id: requirement.id,
      met: true,
      evidence: "Invoice B deleted"
    }))
  })

const otherInvoices: AgentTaskConstraint = {
  id: "c1",
  text: "Do not delete any invoice other than Invoice B.",
  kind: "exclude",
  forbids: ["destructive"],
  inferred: ["destructive"],
  about: { type: "other_records" }
}

describe("completion of a constraint with a stated target", () => {
  it("reads a class lifted for a held step as no violation", () => {
    expect(judged([otherInvoices], deleted(["c1"]))).not.toMatchObject({
      reason: "contradicted_state"
    })
  })

  it("still reads the class as a violation where no check held", () => {
    expect(judged([otherInvoices], deleted())).toMatchObject({
      type: "refused",
      reason: "contradicted_state"
    })
    /** A class from the user's words binds a held step all the same. */
    expect(
      judged([{ ...otherInvoices, inferred: undefined }], deleted(["c1"]))
    ).toMatchObject({ type: "refused", reason: "contradicted_state" })
  })

  it("settles a target the runtime checked before every act, and not otherwise", () => {
    const option: AgentTaskConstraint = {
      id: "c1",
      text: "Do not add travel insurance.",
      kind: "exclude",
      about: {
        type: "option",
        hold: { type: "checked", name: "Travel insurance", checked: false }
      }
    }
    const reviewed = (steps: AgentStepReadout[]) => {
      const judgement = judged([option], steps)
      return judgement.type === "refused"
        ? (judgement.review?.constraintIds ?? [])
        : []
    }
    expect(reviewed(deleted())).toContain("c1")
    expect(reviewed(deleted(["c1"]))).not.toContain("c1")
  })

  it("refuses a count the receipts exceed on one control", () => {
    const once = { ...deleteB, times: 1 }
    const again = (sequence: number, name: string) =>
      step({
        sequence,
        stepId: `run-1:${sequence}`,
        requirementId: "r1",
        consequential: ["destructive"],
        target: { name, rowContext: "Invoice B Delete" }
      })
    expect(
      judged([], [...deleted(), again(3, "Delete")], [once])
    ).toMatchObject({ type: "refused", reason: "contradicted_state" })
    expect(judged([], deleted(), [once])).not.toMatchObject({
      reason: "contradicted_state"
    })
    /** The page's own Confirm after the Delete finishes one delete. */
    expect(
      judged([], [...deleted(), again(3, "Confirm")], [once])
    ).not.toMatchObject({ reason: "contradicted_state" })
  })

  it("refuses two acts on one item of a count of one, though the total fits", () => {
    const payEach: AgentTaskRequirement = {
      id: "r1",
      text: "Each invoice is paid",
      kind: "change",
      times: 1,
      items: ["Invoice A", "Invoice B"]
    }
    const pay = (sequence: number) =>
      step({
        sequence,
        stepId: `run-1:${sequence}`,
        requirementId: "r1",
        consequential: ["payment"],
        target: { name: "Pay", rowContext: "Invoice A Pay" }
      })
    const judgement = judged([], [pay(1), pay(2)], [payEach])
    expect(judgement).toMatchObject({
      type: "refused",
      reason: "contradicted_state"
    })
    expect(judgement.type === "refused" && judgement.feedback).toContain(
      '"Invoice A"'
    )
  })

  it("refuses a met claim on fewer acts than a count of two or more", () => {
    const twice = { ...deleteB, text: "Send the reminder", times: 2 }
    const send = (sequence: number) =>
      step({
        sequence,
        stepId: `run-1:${sequence}`,
        requirementId: "r1",
        consequential: ["submission"],
        target: { name: "Send" }
      })
    const short = judged([], [send(1)], [twice])
    expect(short).toMatchObject({ type: "refused", reason: "missing_evidence" })
    expect(short.type === "refused" && short.feedback).toContain(
      "asks for its act 2 times"
    )
    expect(judged([], [send(1), send(2)], [twice])).not.toMatchObject({
      feedback: expect.stringContaining("asks for its act")
    })
    /** A run that reports the outcome unmet is not refused for the count. */
    expect(
      judgeAgentCompletion({
        steps: [send(1)],
        observation: observation(),
        requirements: [twice],
        outcomes: [{ id: "r1", met: false }]
      })
    ).not.toMatchObject({
      feedback: expect.stringContaining("asks for its act")
    })
  })

  it("never refuses a count for an act it cannot see", () => {
    /** The run bound no counted act to r1: the other evidence still decides. */
    for (const times of [1, 3])
      expect(judged([], [], [{ ...deleteB, times }])).not.toMatchObject({
        feedback: expect.stringContaining("asks for its act")
      })
    /** A routine click is never counted, so it never falls short either. */
    const loadMore = step({
      sequence: 1,
      requirementId: "r1",
      consequential: [],
      target: { name: "Load more" }
    })
    expect(
      judged([], [loadMore], [{ ...deleteB, times: 3 }])
    ).not.toMatchObject({
      feedback: expect.stringContaining("asks for its act")
    })
  })
})
