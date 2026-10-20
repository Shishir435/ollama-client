import type {
  AgentDecision,
  AgentEvidenceRecord,
  AgentObservation,
  AgentRunState,
  AgentScreenshot
} from "@ollama-client/contracts"
import {
  AgentEvidenceRecordSchema,
  MAX_AGENT_LEDGER_BYTES
} from "@ollama-client/contracts"
import { describe, expect, it } from "vitest"
import { judgeAgentCompletion } from "../completion"
import {
  agentCompletionEvidence,
  boundAgentEvidence,
  agentUnretainedSighting,
  agentUnretainedSource,
  agentWriteShownBefore,
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
const picture: AgentScreenshot = {
  snapshotId: "s1",
  generation: 1,
  tabId: 7,
  frameId: 0,
  documentId: "a",
  capturedAt: 12,
  mimeType: "image/jpeg",
  data: "IMAGEBYTES",
  imageWidth: 100,
  imageHeight: 100,
  region: { x: 0, y: 0, width: 100, height: 100 },
  scale: 1,
  scroll: { x: 0, y: 0 },
  maskedRegions: 0
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

  it("never records the run's own typed text as a read off the screenshot", () => {
    const complete = {
      type: "complete" as const,
      summary: "Done",
      outcomes: [{ id: "r1", met: true, evidence: "KV-305" }]
    }
    const typed: AgentStepReadout = {
      runId: "run",
      stepId: "guess",
      sequence: 1,
      status: "verified",
      at: 1,
      mutating: true,
      command: {
        type: "clear_and_type",
        ref: "e1",
        snapshotId: "s1",
        generation: 1,
        text: "KV-305"
      }
    }
    expect(
      agentCompletionEvidence(
        state,
        observation,
        complete,
        [typed],
        "answer",
        picture
      )
    ).toEqual([])
    /** Nor the same value reworded by spacing, case or punctuation. */
    expect(
      agentCompletionEvidence(
        state,
        observation,
        {
          ...complete,
          outcomes: [{ id: "r1", met: true, evidence: "The code is kv 305" }]
        },
        [typed],
        "answer",
        picture
      )
    ).toEqual([])
    /** Nor what an editable field now holds, typed or not. */
    expect(
      agentCompletionEvidence(
        state,
        {
          ...observation,
          elements: [
            {
              ref: "e1",
              frameId: 0,
              tag: "input",
              name: "Code",
              value: "KV-305",
              visible: true,
              enabled: true,
              editable: true,
              sensitive: false
            }
          ]
        },
        complete,
        [],
        "answer",
        picture
      )
    ).toEqual([])
  })

  it("does not let a blank editable field hide a screenshot answer", () => {
    const records = agentCompletionEvidence(
      state,
      {
        ...observation,
        elements: [
          {
            ref: "e1",
            frameId: 0,
            tag: "input",
            name: "Notes",
            value: "   ",
            visible: true,
            enabled: true,
            editable: true,
            sensitive: false
          }
        ]
      },
      {
        type: "complete",
        summary: "Done",
        outcomes: [{ id: "r1", met: true, evidence: "KV-305" }]
      },
      [],
      "answer",
      picture
    )
    expect(records.map((record) => record.kind)).toEqual(["visual_observation"])
  })

  it("keeps a decimal answer that only looks like a field's number when compacted", () => {
    const withField = (value: string) => ({
      ...observation,
      elements: [
        {
          ref: "e1",
          frameId: 0,
          tag: "input",
          name: "Quantity",
          value,
          visible: true,
          enabled: true,
          editable: true,
          sensitive: false
        }
      ]
    })
    const read = (evidence: string) => ({
      type: "complete" as const,
      summary: "Done",
      outcomes: [{ id: "r1", met: true, evidence }]
    })
    expect(
      agentCompletionEvidence(
        state,
        withField("12"),
        read("1.2"),
        [],
        "answer",
        picture
      ).map((record) => record.kind)
    ).toEqual(["visual_observation"])
    expect(
      agentCompletionEvidence(
        state,
        withField("1.2"),
        read("1.2"),
        [],
        "answer",
        picture
      )
    ).toEqual([])
  })

  it("matches supplied text only on word edges, never inside another word", () => {
    const field = (value: string) => ({
      ...observation,
      elements: [
        {
          ref: "e1",
          frameId: 0,
          tag: "input",
          name: "Coupon",
          value,
          visible: true,
          enabled: true,
          editable: true,
          sensitive: false
        }
      ]
    })
    const read = (evidence: string) => ({
      type: "complete" as const,
      summary: "Done",
      outcomes: [{ id: "r1", met: true, evidence }]
    })
    const kinds = (value: string, evidence: string) =>
      agentCompletionEvidence(
        state,
        field(value),
        read(evidence),
        [],
        "answer",
        picture
      ).map((record) => record.kind)
    /** "AB-12" compacts into "Lab 12", but not on a word edge. */
    expect(kinds("AB-12", "Lab 12 is open")).toEqual(["visual_observation"])
    /** Whole words still match, joined or split. */
    expect(kinds("KV305", "The code is KV 305")).toEqual([])
    expect(kinds("KV 305", "Code KV-305")).toEqual([])
    /** A point after a letter is punctuation; only between digits is it a number. */
    expect(kinds("AB.12", "AB 12")).toEqual([])
    expect(kinds("12", "Version 1.2")).toEqual(["visual_observation"])
    /** A quotation is held to the same edges. */
    expect(
      groundAgentQuotes(
        state,
        observation,
        [{ quote: "Plan A costs $12" }],
        ["AN-A"],
        "x"
      ).map((record) => record.quote)
    ).toEqual(["Plan A costs $12"])
    expect(
      groundAgentQuotes(
        state,
        observation,
        [{ quote: "Plan A costs $12" }],
        ["plan-a"],
        "x"
      )
    ).toEqual([])
  })

  it("keeps screenshot answers alongside unrelated text for the same requirement", () => {
    const decision: Extract<AgentDecision, { type: "complete" }> = {
      type: "complete",
      summary: "Done",
      sourceQuotes: [{ quote: "Plan A costs $12", requirementId: "r1" }],
      outcomes: [{ id: "r1", met: true, evidence: "KV-305" }]
    }
    const records = agentCompletionEvidence(
      state,
      observation,
      decision,
      [],
      "answer",
      picture
    )
    expect(records.map((record) => record.kind)).toEqual([
      "observed_fact",
      "visual_observation"
    ])
    expect(
      judgeAgentCompletion({
        steps: [],
        observation,
        requirements: state.requirements,
        outcomes: decision.outcomes,
        evidenceLedger: records
      })
    ).toEqual({
      type: "accepted",
      outcome: { met: ["r1"], unmet: [], graded: true, visual: ["r1"] }
    })
  })

  it.each([false, true])(
    "completes itemized screenshot reads with mixed text support: %s",
    (mixed) => {
      const planned: AgentRunState = {
        ...state,
        requirements: [
          {
            id: "r1",
            text: "Report both plan prices",
            kind: "read",
            items: ["Plan A", "Plan B"]
          }
        ]
      }
      const decision: Extract<AgentDecision, { type: "complete" }> = {
        type: "complete",
        summary: "Done",
        sourceQuotes: [{ quote: "Plan A", requirementId: "r1" }],
        outcomes: [
          {
            id: "r1",
            met: true,
            /** The judge ignores a parent's quotation for itemized reads. */
            evidence: "Plan A costs $12",
            items: [
              {
                index: 0,
                met: true,
                evidence: mixed ? "Plan A costs $12" : "Plan A costs $22"
              },
              { index: 1, met: true, evidence: "Plan B costs $25" }
            ]
          }
        ]
      }
      const records = agentCompletionEvidence(
        planned,
        observation,
        decision,
        [],
        "answer",
        picture
      )
      const visual = records.filter(
        (record) => record.kind === "visual_observation"
      )
      expect(visual.map((record) => record.quote)).toEqual(
        mixed ? ["Plan B costs $25"] : ["Plan A costs $22", "Plan B costs $25"]
      )
      expect(new Set(visual.map((record) => record.id)).size).toBe(
        visual.length
      )
      expect(JSON.stringify(records)).not.toContain("IMAGEBYTES")
      expect(
        judgeAgentCompletion({
          steps: [],
          observation,
          requirements: planned.requirements,
          outcomes: decision.outcomes,
          evidenceLedger: records
        })
      ).toEqual({
        type: "accepted",
        outcome: {
          met: ["r1"],
          unmet: [],
          graded: true,
          visual: ["r1"],
          items: [{ id: "r1", met: [0, 1], visual: mixed ? [1] : [0, 1] }]
        }
      })
      for (const screenshot of [undefined, { ...picture, generation: 2 }]) {
        const ledger = agentCompletionEvidence(
          planned,
          observation,
          decision,
          [],
          "answer",
          screenshot
        )
        expect(
          ledger.some((record) => record.kind === "visual_observation")
        ).toBe(false)
        expect(
          judgeAgentCompletion({
            steps: [],
            observation,
            requirements: planned.requirements,
            outcomes: decision.outcomes,
            evidenceLedger: ledger
          }).type
        ).toBe("refused")
      }
    }
  )

  it("does not retain unmet or sensitive item screenshot readings", () => {
    const records = agentCompletionEvidence(
      {
        ...state,
        requirements: [
          { id: "r1", text: "Read the codes", kind: "read", items: ["A", "B"] }
        ]
      },
      observation,
      {
        type: "complete",
        summary: "Partial",
        outcomes: [
          {
            id: "r1",
            met: true,
            items: [
              { index: 0, met: false, evidence: "A code: KV-305" },
              { index: 1, met: true, evidence: "B token=private" }
            ]
          }
        ]
      },
      [],
      "answer",
      picture
    )
    expect(records).toEqual([])
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

  it("evicts receipts before facts, and protected records last", () => {
    const fact = grounded()[0]
    const facts = Array.from({ length: 5 }, (_, index) => ({
      ...fact,
      id: `fact-${index}`
    }))
    const receipts = Array.from({ length: 40 }, (_, index) => ({
      id: `effect-${index}`,
      kind: "verified_effect" as const,
      validity: "historical" as const,
      source: fact.source,
      observedAt: index,
      verificationKind: "navigation"
    }))
    const kept = boundAgentEvidence([...facts, ...receipts])
    expect(kept.length).toBeLessThanOrEqual(24)
    expect(kept.filter((record) => record.id.startsWith("fact"))).toHaveLength(
      5
    )
    expect(kept.at(-1)?.id).toBe("effect-39")

    /** A receipt showing a change's result is the change's only citation. */
    const field = { ...receipts[0], id: "field-0", verificationKind: "field" }
    expect(
      boundAgentEvidence([field, ...facts, ...receipts]).map(
        (record) => record.id
      )
    ).toContain("field-0")

    const crowded = Array.from({ length: 30 }, (_, index) => ({
      ...fact,
      id: `fact-${index}`
    }))
    const protectedKept = boundAgentEvidence(
      [receipts[0], ...crowded],
      [receipts[0].id]
    )
    expect(protectedKept.map((record) => record.id)).toContain("effect-0")
    expect(protectedKept.map((record) => record.id)).not.toContain("fact-0")
  })
})

describe("leaving a page that names a read item", () => {
  const orders: AgentObservation = {
    ...observation,
    visibleText:
      "Orders, page 1 of 5 ORD-1042 Ada Lovelace ORD-1043 Charles Babbage"
  }
  const reading: Pick<AgentRunState, "requirements" | "evidenceLedger"> = {
    requirements: [
      {
        id: "r1",
        text: "Report every order Ada Lovelace placed.",
        kind: "read",
        items: ["Ada Lovelace"]
      }
    ]
  }
  const next: Extract<AgentDecision, { type: "command" }> = {
    type: "command",
    requirementId: "r1",
    command: { type: "click", ref: "e1", snapshotId: "s1", generation: 1 }
  }

  it("names the item a page shows and nothing retained", () => {
    expect(agentUnretainedSighting(reading, orders, next)).toEqual({
      requirementId: "r1",
      item: "Ada Lovelace"
    })
  })

  it("lets the step go once the page's facts ride on it or were kept", () => {
    expect(
      agentUnretainedSighting(reading, orders, {
        ...next,
        sourceQuotes: [{ quote: "ORD-1042 Ada Lovelace", requirementId: "r1" }]
      })
    ).toBeUndefined()
    const kept = groundAgentQuotes(
      { ...state, ...reading },
      orders,
      [{ quote: "ORD-1042 Ada Lovelace", requirementId: "r1" }],
      [],
      "run:1"
    )
    expect(kept).toHaveLength(1)
    expect(
      agentUnretainedSighting(
        { ...reading, evidenceLedger: kept },
        orders,
        next
      )
    ).toBeUndefined()
  })

  it("ignores pages that do not name the item and change requirements", () => {
    expect(
      agentUnretainedSighting(
        reading,
        { ...orders, visibleText: "ORD-1111 Ada Byron" },
        next
      )
    ).toBeUndefined()
    expect(
      agentUnretainedSighting(
        {
          requirements: [
            {
              id: "r1",
              text: "Mark Ada Lovelace paid.",
              kind: "change",
              items: ["Ada Lovelace"]
            }
          ]
        },
        orders,
        next
      )
    ).toBeUndefined()
  })
})

describe("a quote read inside an embedded frame", () => {
  const root = "Embedded application"
  const widget = "Record 3 Saved Confirmation code: QF-1"
  const framed: AgentObservation = {
    ...observation,
    visibleText: `${root}\n${widget}`,
    frames: [
      { ...observation.frames[0], textSpan: { start: 0, end: root.length } },
      {
        frameId: 6,
        parentFrameId: 0,
        documentId: "w",
        snapshotId: "s1",
        generation: 1,
        origin: "https://example.com",
        url: "https://example.com/widget",
        access: "ok",
        textSpan: {
          start: root.length + 1,
          end: root.length + 1 + widget.length
        }
      }
    ]
  }

  it("is grounded in the one frame whose text holds it", () => {
    const [record] = groundAgentQuotes(
      state,
      framed,
      [{ quote: "Record 3 Saved", requirementId: "r1" }],
      [],
      "run:1"
    )
    expect(record?.source).toMatchObject({ frameId: 6, documentId: "w" })
  })

  it("is not grounded where no frame's own text holds it", () => {
    expect(
      groundAgentQuotes(
        state,
        framed,
        [{ quote: "application Record 3", requirementId: "r1" }],
        [],
        "run:1"
      )
    ).toEqual([])
  })
})

describe("the read items a fact's page opens with", () => {
  const shop: AgentObservation = {
    ...observation,
    visibleText:
      "Kettle Corner Product Price Blue Kettle 41 credits Add to cart"
  }
  const reading = {
    ...state,
    requirements: [
      {
        id: "r1",
        text: "Read each shop's price",
        kind: "read" as const,
        items: ["Kettle Corner", "Brew Bazaar"]
      }
    ]
  }

  it("records the plan's own item names, never more page text", () => {
    const [record] = groundAgentQuotes(
      reading,
      shop,
      [{ quote: "Blue Kettle 41 credits", requirementId: "r1" }],
      [],
      "run:1"
    )
    expect(record?.pageItems).toEqual(["Kettle Corner"])
    expect(JSON.stringify(record)).not.toContain("Add to cart")
  })
})

describe("leaving a source opened for a read", () => {
  const reading: Pick<AgentRunState, "requirements" | "evidenceLedger"> = {
    requirements: [{ id: "r1", text: "Report each offer's code", kind: "read" }]
  }
  const leave: Extract<AgentDecision, { type: "command" }> = {
    type: "command",
    command: { type: "back", snapshotId: "s1", generation: 1 }
  }
  const opened = (requirementId?: string): AgentStepReadout => ({
    runId: "run",
    stepId: "run:1",
    sequence: 1,
    status: "verified",
    at: 1,
    ...(requirementId ? { requirementId } : {}),
    command: { type: "click", ref: "e1", snapshotId: "s0", generation: 1 },
    target: { ref: "e1", tag: "a", name: "Source A" },
    verification: {
      outcome: "confirmed",
      evidence: {
        kind: "activation",
        summary: "Authorized destination is committed",
        observedAt: 1
      }
    }
  })

  it("names the link it was opened from while nothing is kept", () => {
    expect(
      agentUnretainedSource(reading, observation, leave, [opened("r1")])
    ).toEqual({ requirementId: "r1", link: "Source A" })
  })

  it("lets the step go once a fact is kept, or the link was for no read", () => {
    expect(
      agentUnretainedSource(
        reading,
        observation,
        { ...leave, sourceQuotes: [{ quote: "Plan A costs $12" }] },
        [opened("r1")]
      )
    ).toBeUndefined()
    expect(
      agentUnretainedSource(
        { ...reading, evidenceLedger: grounded() },
        observation,
        leave,
        [opened("r1")]
      )
    ).toBeUndefined()
    expect(
      agentUnretainedSource(reading, observation, leave, [opened()])
    ).toBeUndefined()
  })
})

describe("agentWriteShownBefore", () => {
  const type = (text: string) => ({
    type: "type" as const,
    ref: "e1",
    text,
    snapshotId: "s1",
    generation: 1
  })
  it("is true only when the page's own text already held every word", () => {
    expect(agentWriteShownBefore(type("Plan B"), observation)).toBe(true)
    expect(agentWriteShownBefore(type("Plan C"), observation)).toBe(false)
    expect(agentWriteShownBefore(type("  "), observation)).toBe(false)
  })
  it("never counts a field's value as the page's text", () => {
    expect(
      agentWriteShownBefore(type("Plan B"), {
        ...observation,
        elements: [
          {
            ref: "e1",
            frameId: 0,
            tag: "input",
            name: "Name",
            value: "Plan B",
            editable: true,
            visible: true,
            sensitive: false,
            enabled: true
          }
        ]
      })
    ).toBe(false)
  })
})
