import {
  type AgentEvidenceRecord,
  type AgentObservation,
  type AgentRunState,
  AgentRunStateSchema,
  AgentWorkflowSchema,
  MAX_AGENT_LEDGER_BYTES,
  MAX_AGENT_LEDGER_RECORDS,
  MAX_AGENT_WORKFLOW_BYTES
} from "@ollama-client/contracts"
import { describe, expect, it } from "vitest"
import { buildAgentHistory } from "../history"
import type { AgentStepReadout } from "../ports"
import { buildAgentWorkflow, projectAgentWorkflow } from "../workflow"

const state: AgentRunState = {
  version: 1,
  id: "run",
  goal: "Compare Alpha, Beta, Gamma and Delta; don't submit",
  status: "observing",
  stepCount: 40,
  observationCount: 40,
  controlledTabId: 7,
  providerId: "ollama",
  modelId: "model",
  allowedOrigins: ["https://example.com"],
  createdAt: 1,
  updatedAt: 10,
  requirements: [
    {
      id: "r1",
      text: "Compare prices",
      kind: "read",
      items: ["Alpha", "Beta", "Gamma", "Delta"]
    }
  ],
  constraints: [
    { id: "c1", text: "don't submit", kind: "exclude", forbids: ["submission"] }
  ]
}
const observation: AgentObservation = {
  snapshotId: "now",
  generation: 2,
  tabId: 7,
  frameId: 0,
  documentId: "current",
  url: "https://example.com/current",
  origin: "https://example.com",
  title: "Current",
  elements: [],
  visibleText: "Current",
  dialogs: [],
  capturedAt: 10,
  frames: [
    {
      frameId: 0,
      documentId: "current",
      snapshotId: "now",
      generation: 2,
      origin: "https://example.com",
      url: "https://example.com/current",
      access: "ok"
    }
  ],
  scroll: {
    x: 0,
    y: 0,
    viewportWidth: 100,
    viewportHeight: 100,
    documentWidth: 100,
    documentHeight: 100
  }
}
const fact = (id: string, quote: string, tabId = 8): AgentEvidenceRecord => ({
  id,
  quote,
  kind: "observed_fact",
  validity: "current",
  requirementId: "r1",
  observedAt: 1,
  source: {
    tabId,
    frameId: 0,
    documentId: `doc-${tabId}`,
    snapshotId: "old",
    generation: 1,
    origin: "https://example.com"
  }
})
const step = (
  sequence: number,
  overrides: Partial<AgentStepReadout> = {}
): AgentStepReadout => ({
  runId: "run",
  stepId: `run:${sequence}`,
  status: "verified",
  at: sequence,
  sequence,
  command: { type: "read", snapshotId: "old", generation: 1 },
  verification: {
    outcome: "confirmed",
    evidence: { kind: "read", summary: "Read", observedAt: sequence }
  },
  ...overrides
})

describe("durable workflow progress", () => {
  it("retains four closed-tab comparison facts after forty later reads", () => {
    const early =
      state.requirements?.[0].items?.map((item, index) =>
        step(index + 1, {
          evidenceLedger: [
            fact(`price-${item}`, `${item} costs $${index + 1}`, index + 8)
          ]
        })
      ) ?? []
    const recent = Array.from({ length: 40 }, (_, index) =>
      step(index + 5, {
        finding: `Inference ${index}`,
        evidenceLedger: [fact(`noise-${index}`, `Unrelated news ${index}`, 20)]
      })
    )
    const receipts = [...early, ...recent]
    expect(buildAgentHistory(receipts)).toHaveLength(12)
    expect(buildAgentHistory(receipts)[0].step).toBeGreaterThan(4)
    const result = buildAgentWorkflow(state, receipts, observation)
    expect(result?.workflow.entries.map((entry) => entry.status)).toEqual(
      Array(4).fill("supported")
    )
    for (const item of ["Alpha", "Beta", "Gamma", "Delta"])
      expect(
        result?.evidenceLedger.some(
          (entry) =>
            entry.quote?.startsWith(item) && entry.validity === "historical"
        )
      ).toBe(true)
    expect(result?.workflow.phase.kind).toBe("review")
    expect(state.constraints?.[0].forbids).toEqual(["submission"])
  })

  it("keeps all four sources for a non-itemized comparison", () => {
    const current = {
      ...state,
      requirements: [
        { id: "r1", text: "Compare prices", kind: "read" as const }
      ]
    }
    const receipts = ["Alpha", "Beta", "Gamma", "Delta"].map((name, index) =>
      step(index + 1, {
        evidenceLedger: [fact(`price-${name}`, `${name} costs $1`, index + 8)]
      })
    )
    expect(
      buildAgentWorkflow(current, receipts, observation)?.workflow.entries[0]
        .evidenceIds
    ).toHaveLength(4)
  })

  it("does not let a busy second document crowd out the first comparison source", () => {
    const current = {
      ...state,
      requirements: [
        { id: "r1", text: "Compare Alpha and Beta", kind: "read" as const }
      ]
    }
    const receipts = [
      step(1, { evidenceLedger: [fact("alpha", "Alpha costs $1", 8)] }),
      ...Array.from({ length: 40 }, (_, index) =>
        step(index + 2, {
          evidenceLedger: [fact(`beta-${index}`, `Beta feature ${index}`, 9)]
        })
      )
    ]
    const result = buildAgentWorkflow(current, receipts, observation)
    expect(result?.workflow.entries[0].evidenceIds).toContain("alpha")
    expect(
      result?.evidenceLedger.find((record) => record.id === "alpha")?.validity
    ).toBe("historical")
    expect(result?.workflow.entries[0].evidenceIds).toContain("beta-39")
  })

  it("tracks exact entities and resumes the next unfinished one without crediting a click as a save", () => {
    const current = {
      ...state,
      requirements: [
        {
          id: "r1",
          text: "Check",
          kind: "change" as const,
          items: ["Invoice 1", "Invoice 2", "Invoice 10"]
        }
      ]
    }
    const checked = step(1, {
      requirementId: "r1",
      mutating: true,
      command: {
        type: "check",
        ref: "e1",
        snapshotId: "old",
        generation: 1
      },
      target: { name: "Invoice 1", role: "checkbox" },
      verification: {
        outcome: "confirmed",
        evidence: { kind: "checked", summary: "Checked", observedAt: 1 }
      }
    })
    const progress = buildAgentWorkflow(current, [checked], observation)
    expect(progress?.workflow.entries.map((entry) => entry.status)).toEqual([
      "verified",
      "pending",
      "pending"
    ])
    expect(progress?.workflow.phase.index).toBe(1)
    expect(progress?.workflow.entries[0].effect).toEqual({
      sequence: 1,
      settlement: "confirmed"
    })
    const resumed = AgentRunStateSchema.parse({
      ...current,
      ...progress,
      status: "paused"
    })
    expect(
      buildAgentWorkflow(resumed, [checked], observation)?.workflow
    ).toEqual(progress?.workflow)
    expect(resumed.stepCount).toBe(40)
    expect(resumed.constraints).toEqual(state.constraints)
    const clicked = {
      ...checked,
      command: {
        type: "click" as const,
        ref: "e1",
        snapshotId: "old",
        generation: 1
      },
      verification: {
        outcome: "confirmed" as const,
        evidence: { kind: "activation", summary: "Pressed", observedAt: 1 }
      }
    }
    const saving = {
      ...current,
      requirements: [
        { ...current.requirements[0], text: "Save the named invoices" }
      ]
    }
    expect(
      buildAgentWorkflow(saving, [clicked], observation)?.workflow.entries[0]
        .status
    ).toBe("effect_confirmed")
    expect(
      buildAgentWorkflow(saving, [clicked], observation)?.workflow.phase.kind
    ).toBe("verify")
  })

  it("preserves uncertainty and superseded evidence instead of replaying a mutation", () => {
    const current = {
      ...state,
      requirements: [
        {
          id: "r1",
          text: "Save Alpha",
          kind: "change" as const,
          items: ["Alpha"]
        }
      ]
    }
    const receipts = [
      step(1, {
        requirementId: "r1",
        mutating: true,
        status: "uncertain",
        target: { name: "Save Alpha" },
        evidenceLedger: [fact("a", "Alpha costs $1")]
      })
    ]
    const progress = buildAgentWorkflow(current, receipts, observation)
    expect(progress?.workflow.entries[0]).toMatchObject({
      status: "effect_uncertain",
      effect: { sequence: 1, settlement: "unknown" },
      blocker: "effect_unresolved"
    })
    expect(progress?.workflow.phase.kind).toBe("reconcile")
    const superseded = [
      step(1, { evidenceLedger: [fact("a", "Alpha costs $1")] }),
      step(2, {
        evidenceLedger: [
          { ...fact("a", "Alpha costs $1"), validity: "superseded" }
        ]
      })
    ]
    expect(
      buildAgentWorkflow(state, superseded, observation)?.workflow.entries[0]
    ).toMatchObject({ status: "needs_refresh", evidenceIds: [] })
  })

  it("marks prompt omissions and failed receipt reads as unknown", () => {
    const progress = buildAgentWorkflow(
      state,
      [step(1, { evidenceLedger: [fact("a", "Alpha costs $1")] })],
      observation
    )
    if (!progress) throw new Error("missing progress")
    expect(
      projectAgentWorkflow(progress.workflow, []).entries[0]
    ).toMatchObject({
      status: "needs_refresh",
      blocker: "evidence_unavailable"
    })
    expect(
      buildAgentWorkflow({ ...state, ...progress }, undefined, observation)
        ?.workflow.entries[0]
    ).toMatchObject({ status: "needs_refresh", blocker: "history_unavailable" })
    const refresh = {
      ...observation,
      tabId: 8,
      frames: [
        { ...observation.frames[0], documentId: "doc-8", snapshotId: "new" }
      ]
    }
    expect(
      buildAgentWorkflow(
        state,
        [step(1, { evidenceLedger: [fact("a", "Alpha costs $1")] })],
        refresh
      )?.workflow.entries[0].status
    ).toBe("needs_refresh")
  })

  it("bounds long Unicode histories and never elevates model findings or unauthorized facts", () => {
    const receipts = Array.from({ length: 400 }, (_, index) =>
      step(index + 1, {
        finding: "Invented: all entities done",
        evidenceLedger: [fact(`${index}`, `Alpha ${"界".repeat(150)}`)]
      })
    )
    const result = buildAgentWorkflow(state, receipts, observation)
    expect(result?.evidenceLedger.length ?? 0).toBeLessThanOrEqual(
      MAX_AGENT_LEDGER_RECORDS
    )
    expect(
      JSON.stringify(result?.evidenceLedger).length * 3
    ).toBeLessThanOrEqual(MAX_AGENT_LEDGER_BYTES)
    expect(JSON.stringify(result?.workflow).length * 3).toBeLessThanOrEqual(
      MAX_AGENT_WORKFLOW_BYTES
    )
    expect(AgentWorkflowSchema.safeParse(result?.workflow).success).toBe(true)
    const malicious = fact("evil", "Alpha done")
    if (malicious.source) malicious.source.origin = "https://unauthorized.com"
    expect(
      buildAgentWorkflow(
        state,
        [step(1, { finding: "Alpha done", evidenceLedger: [malicious] })],
        observation
      )?.workflow.entries[0].status
    ).not.toBe("supported")
    expect(
      AgentRunStateSchema.safeParse({ ...state, workflow: undefined }).success
    ).toBe(true)
  })
})
