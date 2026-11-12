import {
  type AgentEvidenceRecord,
  type AgentObservation,
  type AgentRunState,
  AgentWorkflowSchema
} from "@ollama-client/contracts"
import { describe, expect, it } from "vitest"
import type { AgentStepReadout } from "../ports"
import { buildAgentWorkflow, projectAgentWorkflow } from "../workflow"

const state = (text: string, items?: string[]): AgentRunState => ({
  version: 1,
  id: "run",
  goal: "Complete the application. Review all pages. Submit it once.",
  status: "observing",
  stepCount: 10,
  observationCount: 10,
  controlledTabId: 7,
  providerId: "ollama",
  modelId: "model",
  allowedOrigins: ["https://example.com"],
  createdAt: 1,
  updatedAt: 10,
  requirements: [{ id: "r1", text, kind: "read", ...(items ? { items } : {}) }]
})

const observation: AgentObservation = {
  snapshotId: "now",
  generation: 9,
  tabId: 7,
  frameId: 0,
  documentId: "result",
  url: "https://example.com/result",
  origin: "https://example.com",
  title: "Result",
  elements: [],
  visibleText: "Saved",
  dialogs: [],
  capturedAt: 10,
  frames: [
    {
      frameId: 0,
      documentId: "result",
      snapshotId: "now",
      generation: 9,
      origin: "https://example.com",
      url: "https://example.com/result",
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

const fact = (
  id: string,
  quote: string,
  page: number
): AgentEvidenceRecord => ({
  id,
  quote,
  kind: "observed_fact",
  validity: "current",
  requirementId: "r1",
  observedAt: page,
  source: {
    tabId: 7,
    frameId: 0,
    documentId: `page-${page}`,
    snapshotId: `snap-${page}`,
    generation: page,
    origin: "https://example.com"
  }
})

const read = (
  sequence: number,
  records: AgentEvidenceRecord[]
): AgentStepReadout => ({
  runId: "run",
  stepId: `run:${sequence}`,
  status: "verified",
  at: sequence,
  sequence,
  command: {
    type: "extract_text",
    offset: 0,
    snapshotId: `snap-${sequence}`,
    generation: sequence
  },
  verification: {
    outcome: "confirmed",
    evidence: { kind: "observation", summary: "Read", observedAt: sequence }
  },
  evidenceLedger: records
})

describe("page-review coverage", () => {
  it("names how many documents back a review of all pages and leaves the extent unknown", () => {
    const result = buildAgentWorkflow(
      state("Review all pages."),
      [
        read(1, [fact("p2", "Application, page 2", 2)]),
        read(2, [fact("p3", "Application, page 3", 3)]),
        read(3, [fact("p3b", "Application, page 3 Submit application", 3)])
      ],
      observation
    )
    const entry = result?.workflow.entries[0]
    expect(entry).toMatchObject({
      status: "supported",
      coverage: { documents: 2, extent: "unknown" }
    })
    /** One fact from each covered document, so the run can see which pages. */
    expect(entry?.evidenceIds).toEqual(expect.arrayContaining(["p2"]))
    expect(entry?.evidenceIds.some((id) => id === "p3" || id === "p3b")).toBe(
      true
    )
    expect(AgentWorkflowSchema.safeParse(result?.workflow).success).toBe(true)
  })

  it("never reports coverage for a single read or an enumerated item list", () => {
    const single = buildAgentWorkflow(
      state("Report the confirmation code."),
      [read(1, [fact("p1", "Code QF-1", 1)])],
      observation
    )
    expect(single?.workflow.entries[0]).toMatchObject({ status: "supported" })
    expect(single?.workflow.entries[0]?.coverage).toBeUndefined()
    const itemized = buildAgentWorkflow(
      state("Review all offers.", ["Offer 1", "Offer 2"]),
      [read(1, [fact("o1", "Offer 1 Price 40", 1)])],
      observation
    )
    expect(itemized?.workflow.entries.map((entry) => entry.status)).toEqual([
      "supported",
      "pending"
    ])
    expect(
      itemized?.workflow.entries.every((entry) => entry.coverage === undefined)
    ).toBe(true)
  })

  it("claims nothing before any page has evidence", () => {
    const result = buildAgentWorkflow(
      state("Review all pages."),
      [],
      observation
    )
    expect(result?.workflow.entries[0]).toMatchObject({ status: "pending" })
    expect(result?.workflow.entries[0]?.coverage).toBeUndefined()
  })

  it("claims no covered documents when history is unavailable", () => {
    const result = buildAgentWorkflow(
      state("Review all pages."),
      [read(1, [fact("p1", "Step 1", 1)])],
      observation
    )
    if (!result) throw new Error("missing progress")
    const projected = projectAgentWorkflow(
      result.workflow,
      result.evidenceLedger,
      false
    )
    expect(projected.entries[0]).toMatchObject({
      evidenceIds: [],
      coverage: { documents: 0, extent: "unknown" },
      status: "needs_refresh",
      blocker: "history_unavailable"
    })
  })

  it("counts no document whose evidence has fallen out of the ledger", () => {
    const result = buildAgentWorkflow(
      state("Review every step."),
      [read(1, [fact("p1", "Step 1", 1)]), read(2, [fact("p2", "Step 2", 2)])],
      observation
    )
    if (!result) throw new Error("missing progress")
    const projected = projectAgentWorkflow(
      result.workflow,
      result.evidenceLedger.filter((record) => record.id !== "p1")
    )
    expect(projected.entries[0]).toMatchObject({
      status: "needs_refresh",
      coverage: { documents: 1, extent: "unknown" }
    })
  })
})
