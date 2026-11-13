import type {
  AgentObservation,
  AgentTaskRequirement
} from "@ollama-client/contracts"
import { AgentReadPrerequisitesSchema } from "@ollama-client/contracts"
import { describe, expect, it } from "vitest"
import { answeredAsItsOnlyItem, judgeAgentCompletion } from "../completion"
import { agentCompletionEvidence } from "../evidence-ledger"
import { agentProvenReadPrerequisites } from "../history"
import type { AgentStepReadout, ResolvedAgentEffect } from "../ports"
import { agentReadAnswerDigest } from "../read-answer"
import {
  agentRequiredReads,
  judgeAgentReadPrerequisites
} from "../read-prerequisites"

const observation: AgentObservation = {
  snapshotId: "s2",
  generation: 2,
  tabId: 1,
  frameId: 0,
  documentId: "destination",
  url: "https://example.com/destination",
  origin: "https://example.com",
  title: "Destination",
  capturedAt: 10,
  frames: [
    {
      frameId: 0,
      documentId: "destination",
      snapshotId: "s2",
      generation: 2,
      url: "https://example.com/destination",
      origin: "https://example.com",
      access: "ok"
    }
  ],
  visibleText: "Destination",
  elements: [],
  dialogs: [],
  scroll: {
    x: 0,
    y: 0,
    viewportWidth: 100,
    viewportHeight: 100,
    documentWidth: 100,
    documentHeight: 100
  }
}
const read: AgentTaskRequirement = {
  id: "r1",
  kind: "read",
  text: "Review the delivery policy",
  beforeChanges: true
}
const receipt: AgentStepReadout = {
  runId: "run",
  stepId: "write-1",
  status: "planned",
  sequence: 1,
  at: 2,
  command: {
    type: "type",
    ref: "e1",
    text: "Ada",
    snapshotId: "s1",
    generation: 1
  },
  readPrerequisites: {
    planVersion: 2,
    requirementIds: ["r1"],
    supportedIds: ["r1"],
    answers: [
      {
        id: "r1",
        digest: agentReadAnswerDigest({ evidence: "Delivery policy: 3 days" })!
      }
    ]
  },
  evidenceLedger: [
    {
      id: "write-1:q0",
      kind: "observed_fact",
      validity: "historical",
      quote: "Delivery policy: 3 days",
      requirementId: "r1",
      observedAt: 1,
      source: {
        tabId: 1,
        frameId: 0,
        documentId: "policy",
        snapshotId: "s1",
        generation: 1,
        origin: "https://example.com"
      }
    }
  ]
}
const answer = "Delivery policy: 3 days"

describe("durable read-before-write proofs", () => {
  it.each([
    "rejected",
    "planned",
    "approved",
    "executed",
    "uncertain",
    "verified"
  ] as const)(
    "%s input is treated according to whether it could have reached the page",
    (status) => {
      const seen = { ...observation, visibleText: "Account code: Ada" }
      const state = {
        version: 1 as const,
        id: "run",
        goal: "Read Account",
        status: "deciding" as const,
        controlledTabId: 1,
        stepCount: 0,
        observationCount: 1,
        allowedOrigins: [observation.origin],
        providerId: "ollama",
        modelId: "model",
        createdAt: 1,
        updatedAt: 1,
        requirements: [read]
      }
      const facts = agentCompletionEvidence(
        state,
        seen,
        {
          type: "complete",
          summary: "Account code",
          outcomes: [{ id: "r1", met: true, evidence: "Account code: Ada" }]
        },
        [{ ...receipt, status, readPrerequisites: undefined }],
        "fact"
      )
      expect(facts.some((fact) => fact.kind === "observed_fact")).toBe(
        status === "rejected"
      )
    }
  )
  it("round-trips bounded proof and preserves the review tier", () => {
    const restored = JSON.parse(JSON.stringify(receipt)) as AgentStepReadout
    expect(
      AgentReadPrerequisitesSchema.parse(restored.readPrerequisites)
    ).toEqual(receipt.readPrerequisites)
    expect(agentProvenReadPrerequisites([restored], 2).get("r1")).toBe(
      "supported"
    )
    expect(agentProvenReadPrerequisites([restored], 3).size).toBe(0)
  })

  it("does not mistake a later receipt without the runtime proof for a new proof", () => {
    expect(
      agentProvenReadPrerequisites(
        [{ ...receipt, status: "verified", readPrerequisites: undefined }],
        2
      ).size
    ).toBe(0)
  })

  it("settles an already-supported read without converting it to verified", () => {
    const result = judgeAgentCompletion({
      observation,
      steps: [receipt],
      requirements: [read],
      planVersion: 2,
      outcomes: [{ id: "r1", met: true, evidence: answer }]
    })
    expect(result).toMatchObject({
      type: "accepted",
      outcome: { met: ["r1"], supported: ["r1"] }
    })
  })

  it("settles a restatement that differs only in spacing and case", () => {
    expect(
      judgeAgentCompletion({
        observation,
        steps: [receipt],
        requirements: [read],
        planVersion: 2,
        outcomes: [
          { id: "r1", met: true, evidence: " delivery  POLICY: 3 days" }
        ]
      })
    ).toMatchObject({ type: "accepted", outcome: { supported: ["r1"] } })
  })

  it("settles a lone-item read restated in either answer form", () => {
    const lone = { ...read, items: ["delivery policy"] }
    const plain = { id: "r1", met: true, evidence: answer }
    const proven: AgentStepReadout = {
      ...receipt,
      readPrerequisites: {
        ...receipt.readPrerequisites!,
        answers: [
          {
            id: "r1",
            digest: agentReadAnswerDigest(answeredAsItsOnlyItem(plain, [lone]))!
          }
        ]
      }
    }
    for (const outcome of [
      plain,
      {
        id: "r1",
        met: true,
        items: [{ index: 0, met: true, evidence: answer }]
      }
    ])
      expect(
        judgeAgentCompletion({
          observation,
          steps: [proven],
          requirements: [lone],
          planVersion: 2,
          outcomes: [outcome]
        })
      ).toMatchObject({ type: "accepted", outcome: { supported: ["r1"] } })
  })

  it.each([
    ["no answer under a contradicting summary", undefined],
    ["a changed answer", "Delivery policy: 9 days"],
    ["an answer the proof never retained", "Returns accepted within 30 days"],
    [
      "the proof's own quotation with a changed selection",
      '"Delivery policy: 3 days", so the 9-day courier is the one chosen'
    ]
  ])(
    "judges %s again instead of settling it on the proof",
    (_name, evidence) => {
      const result = judgeAgentCompletion({
        observation,
        steps: [receipt],
        requirements: [read],
        planVersion: 2,
        summary: "Delivery takes 9 days.",
        outcomes: [{ id: "r1", met: true, ...(evidence ? { evidence } : {}) }]
      })
      expect(result.type).not.toBe("accepted")
    }
  )

  it("gives a proof that never recorded its answer no authority over a restatement", () => {
    const { answers: _, ...legacy } = receipt.readPrerequisites!
    expect(AgentReadPrerequisitesSchema.parse(legacy)).toEqual(legacy)
    expect(
      judgeAgentCompletion({
        observation,
        steps: [{ ...receipt, readPrerequisites: legacy }],
        requirements: [read],
        planVersion: 2,
        outcomes: [{ id: "r1", met: true, evidence: answer }]
      }).type
    ).not.toBe("accepted")
  })

  it("reuses a commit dependency's read proof without promoting the tier", () => {
    const { beforeChanges: _, ...dependency } = read
    const result = judgeAgentCompletion({
      observation,
      steps: [receipt],
      requirements: [
        {
          ...dependency,
          items: ["Source 1", "Source 2"],
          itemsFrom: "page",
          itemLinks: ["https://example.com/1", "https://example.com/2"],
          pageItemsComplete: true
        }
      ],
      planVersion: 2,
      outcomes: [{ id: "r1", met: true, evidence: answer }]
    })
    expect(result).toMatchObject({
      type: "accepted",
      outcome: { met: ["r1"], supported: ["r1"] }
    })
  })
  it("does not use a read receipt as proof of a change with the same id", () => {
    expect(
      judgeAgentCompletion({
        observation,
        steps: [receipt],
        requirements: [{ id: "r1", kind: "change", text: "Save destination" }],
        planVersion: 2,
        outcomes: [{ id: "r1", met: true }]
      }).type
    ).not.toBe("accepted")
  })
  it("does not use an old plan's read proof for the new plan", () => {
    expect(
      judgeAgentCompletion({
        observation,
        steps: [receipt],
        requirements: [read],
        planVersion: 3,
        outcomes: [{ id: "r1", met: true }]
      }).type
    ).toBe("refused")
  })

  it("honors an explicitly unmet read even if an earlier phase was supported", () => {
    expect(
      judgeAgentCompletion({
        observation,
        steps: [receipt],
        requirements: [read],
        planVersion: 2,
        outcomes: [{ id: "r1", met: false }]
      }).type
    ).toBe("unmet")
  })

  it("does not infer an unknown prerequisite from receipts of an older plan", () => {
    expect(
      judgeAgentReadPrerequisites([read], [{ id: "r1", met: true }], {
        observation,
        steps: [receipt],
        planVersion: 3
      }).type
    ).toBe("refused")
  })
})

describe("commit dependencies a step's own change must produce", () => {
  const plan: AgentTaskRequirement[] = [
    { id: "r1", kind: "change", text: "Submit the quote request" },
    { id: "r2", kind: "read", text: "Read the returned quote" },
    { id: "r3", kind: "change", text: "Accept the quote", requires: ["r2"] }
  ]
  const commit = (accessibleName?: string) =>
    ({
      semanticEffects: ["submission"],
      target: accessibleName ? { accessibleName } : {}
    }) as unknown as ResolvedAgentEffect
  const owed = (
    requirementId: string | undefined,
    label: string | null = "Submit quote request",
    attempted: string[] = [],
    requirements = plan
  ) =>
    agentRequiredReads(requirements, commit(label ?? undefined), {
      requirementId,
      attempted: new Set(attempted)
    }).map(({ id }) => id)

  it("does not hold the submit control that produces the read the accept owes", () => {
    expect(owed("r1")).toEqual([])
    expect(owed("r1", "Request a quote")).toEqual([])
    expect(owed("r1", "Submitting…")).toEqual([])
  })

  it("still owes the read when the control is the accept, whatever its tag", () => {
    for (const label of [
      "Accept",
      "Accept quote",
      "Submit and accept",
      "Quote",
      "Confirm",
      null
    ])
      expect(owed("r1", label)).toEqual(["r2"])
  })

  it("still owes the read on the dependent commit, untagged steps and repeat commits", () => {
    expect(owed("r3")).toEqual(["r2"])
    expect(owed(undefined)).toEqual(["r2"])
    expect(owed("r1", null, ["r1"])).toEqual(["r2"])
    expect(owed("r1", "Submit quote request", ["r1"])).toEqual(["r2"])
    expect(owed("r2")).toEqual(["r2"])
  })

  it("still owes a read listed before the change, which the change cannot produce", () => {
    expect(owed("r1", null, [], [plan[1], plan[0], plan[2]])).toEqual(["r2"])
    expect(
      owed("r1", "Submit quote request", [], [plan[1], plan[0], plan[2]])
    ).toEqual(["r2"])
  })

  it("never exempts an explicit read-before-changes phase", () => {
    expect(
      owed(
        "r1",
        "Submit quote request",
        [],
        [plan[0], { ...plan[1], beforeChanges: true }, plan[2]]
      )
    ).toEqual(["r2"])
  })

  it("owes the read when changes share the control's words", () => {
    expect(
      owed(
        "r1",
        "Submit",
        [],
        [plan[0], plan[1], { ...plan[2], text: "Submit the acceptance" }]
      )
    ).toEqual(["r2"])
  })
})
