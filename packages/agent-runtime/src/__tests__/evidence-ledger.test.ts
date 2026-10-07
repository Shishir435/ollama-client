import type {
  AgentEvidenceRecord,
  AgentObservation,
  AgentRunState
} from "@ollama-client/contracts"
import {
  AgentEvidenceRecordSchema,
  MAX_AGENT_LEDGER_BYTES
} from "@ollama-client/contracts"
import { describe, expect, it } from "vitest"
import {
  agentCompletionEvidence,
  boundAgentEvidence,
  buildAgentEvidenceLedger,
  groundAgentQuotes
} from "../evidence-ledger"
import type { AgentStepReadout } from "../ports"

const observation: AgentObservation = {
  snapshotId: "s1",
  generation: 1,
  tabId: 7,
  frameId: 0,
  documentId: "a",
  origin: "https://example.com",
  url: "https://example.com/a?token=secret",
  title: "A",
  frames: [
    {
      frameId: 0,
      documentId: "a",
      snapshotId: "s1",
      generation: 1,
      origin: "https://example.com",
      url: "https://example.com/a",
      access: "ok"
    }
  ],
  elements: [],
  visibleText: "Plan A costs $12. Plan B costs $15.",
  dialogs: [],
  capturedAt: 10,
  scroll: {
    x: 0,
    y: 0,
    viewportWidth: 100,
    viewportHeight: 100,
    documentWidth: 100,
    documentHeight: 100
  }
}
const state: AgentRunState = {
  version: 1,
  id: "run",
  goal: "Compare plans",
  status: "deciding",
  stepCount: 0,
  observationCount: 1,
  controlledTabId: 7,
  providerId: "ollama",
  modelId: "model",
  allowedOrigins: ["https://example.com"],
  createdAt: 1,
  updatedAt: 10,
  requirements: [{ id: "r1", text: "Compare plans", kind: "read" }]
}
const grounded = () =>
  groundAgentQuotes(
    state,
    observation,
    [{ quote: "Plan A costs $12", requirementId: "r1" }],
    [],
    "run:1"
  )
const steps = (records: AgentEvidenceRecord[]): AgentStepReadout[] => [
  {
    runId: "run",
    stepId: "run:1",
    status: "planned",
    at: 10,
    sequence: 1,
    evidenceLedger: records
  }
]

describe("grounded evidence ledger", () => {
  it("retains an approved quote, requirement and exact identity, without URL secrets", () => {
    expect(grounded()[0]).toMatchObject({
      kind: "observed_fact",
      quote: "Plan A costs $12",
      requirementId: "r1",
      observedAt: 10,
      source: {
        tabId: 7,
        frameId: 0,
        documentId: "a",
        snapshotId: "s1",
        generation: 1,
        origin: "https://example.com"
      }
    })
    expect(JSON.stringify(grounded())).not.toContain("token")
    expect(JSON.stringify(grounded())).not.toContain("Plan B")
  })
  it("keeps page A attributable after navigation to page B", () => {
    const next = {
      ...observation,
      documentId: "b",
      snapshotId: "s2",
      generation: 2,
      frames: [
        {
          ...observation.frames[0],
          documentId: "b",
          snapshotId: "s2",
          generation: 2
        }
      ]
    }
    expect(
      buildAgentEvidenceLedger(steps(grounded()), state.allowedOrigins, next)[0]
    ).toMatchObject({
      validity: "historical",
      quote: "Plan A costs $12",
      source: { documentId: "a" }
    })
  })
  it("does not give a new snapshot authority to an older observation", () => {
    const next = {
      ...observation,
      snapshotId: "s2",
      frames: [{ ...observation.frames[0], snapshotId: "s2" }]
    }
    expect(
      buildAgentEvidenceLedger(steps(grounded()), state.allowedOrigins, next)[0]
        .validity
    ).toBe("requires_refresh")
    expect(
      buildAgentEvidenceLedger(
        steps(grounded()),
        state.allowedOrigins,
        observation
      )[0].validity
    ).toBe("current")
  })
  it("survives a serialized worker restart as historical support, not current state", () => {
    expect(
      buildAgentEvidenceLedger(
        JSON.parse(JSON.stringify(steps(grounded()))),
        state.allowedOrigins
      )[0]
    ).toMatchObject({
      validity: "historical",
      source: { documentId: "a" },
      quote: "Plan A costs $12"
    })
  })
  it("refuses invented quotes and unknown requirements", () => {
    expect(
      groundAgentQuotes(
        state,
        observation,
        [
          { quote: "Plan A costs $2" },
          { quote: "Plan A", requirementId: "r8" }
        ],
        [],
        "x"
      )
    ).toEqual([])
  })
  it("does not join two separate sources to ground a quotation", () => {
    expect(
      groundAgentQuotes(
        state,
        { ...observation, visibleText: "Plan A", documentText: "costs $12" },
        [{ quote: "Plan A costs $12" }],
        [],
        "x"
      )
    ).toEqual([])
  })
  it("rejects authored text and editable values as independent evidence", () => {
    expect(
      groundAgentQuotes(
        state,
        observation,
        [{ quote: "Plan A costs $12" }],
        ["Plan A costs $12"],
        "x"
      )
    ).toEqual([])
    const edited = {
      ...observation,
      elements: [
        {
          ref: "e1",
          frameId: 0,
          tag: "input",
          name: "Plan A costs $12",
          value: "Plan A costs $12",
          visible: true,
          enabled: true,
          editable: true,
          sensitive: false
        }
      ]
    }
    expect(
      groundAgentQuotes(
        state,
        edited,
        [{ quote: "Plan A costs $12", ref: "e1" }],
        [],
        "x"
      )
    ).toEqual([])
  })
  it("retains independent status text while excluding live authored facts", () => {
    const page = {
      ...observation,
      visibleText: "Plan A costs $12. Saved successfully"
    }
    const previous: AgentStepReadout[] = [
      {
        runId: "run",
        stepId: "typed",
        status: "verified",
        at: 1,
        sequence: 1,
        command: {
          type: "clear_and_type",
          snapshotId: "s1",
          generation: 1,
          ref: "e1",
          text: "Plan A costs $12"
        },
        evidenceLedger: [
          {
            id: "typed:input",
            kind: "agent_input",
            validity: "historical",
            source: grounded()[0].source,
            observedAt: 1
          }
        ]
      }
    ]
    const records = agentCompletionEvidence(
      state,
      page,
      {
        type: "complete",
        summary: "Done",
        sourceQuotes: [
          { quote: "Plan A costs $12" },
          { quote: "Saved successfully" }
        ]
      },
      previous,
      "answer"
    )
    expect(records.map((record) => record.quote)).toEqual([
      "Saved successfully"
    ])
  })

  it("rejects credentials and sensitive control labels", () => {
    for (const text of [
      "Bearer abcdef",
      "password=hello",
      "sk-12345678",
      "foo@example.com"
    ]) {
      expect(
        groundAgentQuotes(
          state,
          { ...observation, visibleText: text },
          [{ quote: text }],
          [],
          "x"
        )
      ).toEqual([])
    }
  })
  it("cannot ground text in an unreadable or unauthorized frame", () => {
    expect(
      groundAgentQuotes(
        { ...state, allowedOrigins: [] },
        observation,
        [{ quote: "Plan A" }],
        [],
        "x"
      )
    ).toEqual([])
    expect(
      groundAgentQuotes(
        state,
        {
          ...observation,
          frames: [{ ...observation.frames[0], access: "excluded" }]
        },
        [{ quote: "Plan A" }],
        [],
        "x"
      )
    ).toEqual([])
    expect(buildAgentEvidenceLedger(steps(grounded()), [])).toEqual([])
  })
  it("does not guess attribution for composed frame text", () => {
    const framed = {
      ...observation,
      frames: [
        ...observation.frames,
        {
          ...observation.frames[0],
          frameId: 2,
          documentId: "child",
          snapshotId: "child-s"
        }
      ]
    }
    expect(
      groundAgentQuotes(state, framed, [{ quote: "Plan A" }], [], "x")
    ).toEqual([])
    const extracted = {
      ...framed,
      textPage: { text: "Plan A costs $12", offset: 0, frameId: 2 }
    }
    expect(
      groundAgentQuotes(
        state,
        extracted,
        [{ quote: "Plan A costs $12", frameId: 2 }],
        [],
        "x"
      )[0].source?.documentId
    ).toBe("child")
  })
  it("keeps an activation's actual verification kind through recovery", () => {
    const effect: AgentEvidenceRecord = {
      ...grounded()[0],
      id: "effect",
      kind: "verified_effect",
      quote: undefined,
      verificationKind: "activation",
      validity: "historical"
    }
    expect(
      buildAgentEvidenceLedger(steps([effect]), state.allowedOrigins)[0]
        .verificationKind
    ).toBe("activation")
    expect(
      AgentEvidenceRecordSchema.safeParse({ ...effect, source: undefined })
        .success
    ).toBe(false)
  })
  it("keeps a confirmed effect historical after a fresh snapshot of the same document", () => {
    const effect: AgentEvidenceRecord = {
      ...grounded()[0],
      kind: "verified_effect",
      validity: "historical",
      verificationKind: "activation",
      quote: undefined
    }
    const fresh = {
      ...observation,
      frames: observation.frames.map((frame) => ({
        ...frame,
        snapshotId: "s2",
        generation: 2
      }))
    }
    const restored = JSON.parse(JSON.stringify(steps([effect])))
    expect(
      buildAgentEvidenceLedger(restored, state.allowedOrigins, fresh)[0]
    ).toMatchObject({ validity: "historical", verificationKind: "activation" })
  })

  it("records requirement association as provenance, independently of satisfaction", () => {
    for (const met of [true, false]) {
      const records = agentCompletionEvidence(
        state,
        observation,
        {
          type: "complete",
          summary: "Done",
          outcomes: [{ id: "r1", met, evidence: "Plan A costs $12" }],
          sourceQuotes: [{ quote: "Plan B costs $15", requirementId: "r1" }]
        },
        [],
        "answer"
      )
      expect(records.map((record) => record.quote)).toEqual([
        "Plan B costs $15",
        "Plan A costs $12"
      ])
      expect(records.every((record) => record.requirementId === "r1")).toBe(
        true
      )
    }
  })

  it("records a read off the completing screenshot by its identity, never the image", () => {
    const picture = {
      snapshotId: "s1",
      generation: 1,
      tabId: 7,
      frameId: 0,
      documentId: "a",
      capturedAt: 12,
      mimeType: "image/jpeg" as const,
      data: "IMAGEBYTES",
      imageWidth: 100,
      imageHeight: 100,
      region: { x: 0, y: 0, width: 100, height: 100 },
      scale: 1,
      scroll: { x: 0, y: 0 },
      maskedRegions: 0
    }
    const complete = (evidence: string) => ({
      type: "complete" as const,
      summary: "Done",
      outcomes: [{ id: "r1", met: true, evidence }]
    })
    const records = agentCompletionEvidence(
      state,
      observation,
      complete("KV-305"),
      [],
      "answer",
      picture
    )
    expect(records).toEqual([
      {
        id: "answer:visual:r1",
        kind: "visual_observation",
        validity: "current",
        source: {
          tabId: 7,
          frameId: 0,
          documentId: "a",
          snapshotId: "s1",
          generation: 1,
          origin: "https://example.com"
        },
        observedAt: 12,
        requirementId: "r1",
        quote: "KV-305"
      }
    ])
    expect(JSON.stringify(records)).not.toContain("IMAGEBYTES")
    expect(AgentEvidenceRecordSchema.safeParse(records[0]).success).toBe(true)

    /** Text that grounds needs no picture, and none is recorded. */
    expect(
      agentCompletionEvidence(
        state,
        observation,
        complete("Plan A costs $12"),
        [],
        "answer",
        picture
      ).map((record) => record.kind)
    ).toEqual(["observed_fact"])
    /** A picture of another snapshot, or none, records nothing. */
    for (const other of [{ ...picture, generation: 2 }, undefined])
      expect(
        agentCompletionEvidence(
          state,
          observation,
          complete("KV-305"),
          [],
          "answer",
          other
        )
      ).toEqual([])
    /** Only a planned read: a picture never stands for a change. */
    expect(
      agentCompletionEvidence(
        {
          ...state,
          requirements: [{ id: "r1", text: "Render it", kind: "change" }]
        },
        observation,
        complete("KV-305"),
        [],
        "answer",
        picture
      )
    ).toEqual([])
  })

  it("enforces count and byte bounds, including a single oversized corrupt record", () => {
    const records = Array.from({ length: 100 }, (_, index) => ({
      ...grounded()[0],
      id: String(index),
      quote: "漢".repeat(200)
    }))
    const kept = boundAgentEvidence(records)
    expect(kept.length).toBeLessThanOrEqual(24)
    expect(
      Array.from(JSON.stringify(kept)).reduce((bytes, character) => {
        const code = character.codePointAt(0) ?? 0
        return bytes + (code < 128 ? 1 : code < 2048 ? 2 : code < 65536 ? 3 : 4)
      }, 0)
    ).toBeLessThanOrEqual(MAX_AGENT_LEDGER_BYTES)
    expect(
      boundAgentEvidence([{ ...grounded()[0], quote: "x".repeat(50000) }])
    ).toEqual([])
  })
})
