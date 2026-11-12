import type {
  AgentObservation,
  AgentTaskRequirement
} from "@ollama-client/contracts"
import { AgentReadPrerequisitesSchema } from "@ollama-client/contracts"
import { describe, expect, it } from "vitest"
import { judgeAgentCompletion } from "../completion"
import { agentCompletionEvidence } from "../evidence-ledger"
import { agentProvenReadPrerequisites } from "../history"
import type { AgentStepReadout } from "../ports"
import { judgeAgentReadPrerequisites } from "../read-prerequisites"

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
    supportedIds: ["r1"]
  }
}

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
      outcomes: [{ id: "r1", met: true }]
    })
    expect(result).toMatchObject({
      type: "accepted",
      outcome: { met: ["r1"], supported: ["r1"] }
    })
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
      outcomes: [{ id: "r1", met: true }]
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
