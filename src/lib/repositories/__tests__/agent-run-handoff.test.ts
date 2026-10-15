import { TERMINAL_AGENT_STATUSES } from "@ollama-client/agent-runtime"
import type { AgentRunState } from "@ollama-client/contracts"
import {
  AGENT_HANDOFF_STATUSES,
  MAX_AGENT_HANDOFF_FINDINGS,
  MAX_AGENT_HANDOFF_RESULT_CHARS
} from "@ollama-client/contracts/agent-handoff"
import { describe, expect, it } from "vitest"
import {
  agentHandoffActions,
  buildAgentConversationHandoff,
  handoffPlainText
} from "../agent-run-handoff"

const settled = (patch: Partial<AgentRunState> = {}): AgentRunState => ({
  version: 1,
  id: "run-1",
  goal: "Compare the two plans",
  status: "completed",
  stepCount: 3,
  observationCount: 4,
  controlledTabId: 7,
  providerId: "ollama",
  modelId: "qwen3",
  allowedOrigins: ["https://example.com"],
  result: "Plan A is cheaper",
  outcome: { met: ["r1"], unmet: ["r2"] },
  createdAt: 1,
  updatedAt: 9,
  ...patch
})

describe("the conversation handoff a settled run leaves", () => {
  it("names exactly the statuses the machine settles in", () => {
    expect([...AGENT_HANDOFF_STATUSES].sort()).toEqual(
      [...TERMINAL_AGENT_STATUSES].sort()
    )
  })

  it("carries the goal, the answer, the outcome and the notes, nothing else", () => {
    expect(buildAgentConversationHandoff(settled(), ["Plan A: $12"])).toEqual({
      version: 1,
      runId: "run-1",
      status: "completed",
      goal: "Compare the two plans",
      result: "Plan A is cheaper",
      outcome: { met: 1, total: 2 },
      findings: ["Plan A: $12"],
      settledAt: 9
    })
  })

  it("grades each planned outcome and lists what cannot be undone", () => {
    const handoff = buildAgentConversationHandoff(
      settled({
        status: "completed_unverified",
        requirements: [
          { id: "r1", kind: "change", text: "Address is saved" },
          { id: "r2", kind: "read", text: "Report the price" },
          { id: "r3", kind: "read", text: "Report the date" }
        ],
        outcome: {
          met: ["r1", "r2"],
          unmet: ["r3"],
          claimed: ["r2"],
          graded: true
        }
      }),
      [],
      [],
      agentHandoffActions([
        { stepId: "s1", status: "planned", consequential: ["submission"] },
        {
          stepId: "s1",
          status: "verified",
          consequential: ["submission"],
          target: { name: "Save https://evil.example/x" }
        },
        { stepId: "s2", status: "uncertain", consequential: ["payment"] },
        { stepId: "s3", status: "rejected", consequential: ["destructive"] },
        { stepId: "s4", status: "verified" }
      ])
    )
    expect(handoff?.requirements).toEqual([
      { id: "r1", text: "Address is saved", tier: "verified" },
      { id: "r2", text: "Report the price", tier: "claimed" },
      { id: "r3", text: "Report the date", tier: "unmet" }
    ])
    /** One per step at its last receipt; refused steps did nothing. */
    expect(handoff?.actions).toEqual([
      { effect: "submission", state: "applied", control: "Save [link]" },
      { effect: "payment", state: "uncertain" }
    ])
  })

  it("leaves the grade off an outcome no grading judge wrote", () => {
    /** A run settled before tiers met its reads on a quote alone. */
    const handoff = buildAgentConversationHandoff(
      settled({
        requirements: [
          { id: "r1", kind: "read", text: "Report the price" },
          { id: "r2", kind: "read", text: "Report the date" }
        ],
        outcome: { met: ["r1"], unmet: ["r2"] }
      }),
      []
    )
    expect(handoff?.requirements).toEqual([
      { id: "r1", text: "Report the price", tier: "met" },
      { id: "r2", text: "Report the date", tier: "unmet" }
    ])
  })

  it("grades nothing for a run that settled before it was judged", () => {
    const handoff = buildAgentConversationHandoff(
      settled({
        status: "failed",
        requirements: [{ id: "r1", kind: "change", text: "Address is saved" }],
        outcome: undefined
      }),
      []
    )
    /** Not met, not unmet: nothing was established. */
    expect(handoff?.requirements).toEqual([
      { id: "r1", text: "Address is saved", tier: "unjudged" }
    ])
  })

  it("writes none for a run that has not settled", () => {
    expect(
      buildAgentConversationHandoff(settled({ status: "executing" }), [])
    ).toBeUndefined()
    expect(
      buildAgentConversationHandoff(settled({ status: "paused" }), [])
    ).toBeUndefined()
  })

  it("keeps the newest notes, once each", () => {
    const notes = Array.from({ length: 10 }, (_, index) => `note ${index}`)
    const handoff = buildAgentConversationHandoff(settled(), [
      ...notes,
      "note 9"
    ])
    expect(handoff?.findings).toHaveLength(MAX_AGENT_HANDOFF_FINDINGS)
    expect(handoff?.findings.at(-1)).toBe("note 9")
    expect(handoff?.findings[0]).toBe("note 4")
  })

  it("bounds the answer a later turn reads", () => {
    const handoff = buildAgentConversationHandoff(
      settled({ result: "x".repeat(20_000) }),
      []
    )
    expect(handoff?.result?.length).toBe(MAX_AGENT_HANDOFF_RESULT_CHARS)
  })
})

describe("text carried into a handoff", () => {
  /**
   * A later model is told what a run found, never where to go next: a link in
   * page-derived text is the shortest path from a hostile page to a second
   * visit.
   */
  it("removes every link a later model could be invited to open", () => {
    expect(
      handoffPlainText(
        "Go to https://evil.example/x or www.evil.example then javascript:alert(1)",
        500
      )
    ).toBe("Go to [link] or [link] then [link])")
  })

  it("removes scheme-relative and bare-host links too", () => {
    expect(
      handoffPlainText(
        "Try //evil.example/path, evil.example/pay?x=1 or pay.evil.co.uk:8080",
        500
      )
    ).toBe("Try [link], [link] or [link]")
  })

  it("leaves prices, versions and ordinary words alone", () => {
    expect(
      handoffPlainText("Plan A costs $12.99, v3.5, e.g. monthly", 500)
    ).toBe("Plan A costs $12.99, v3.5, e.g. monthly")
  })

  it("flattens lines so a note cannot draw its own heading or fence", () => {
    expect(handoffPlainText("one\n\n## SYSTEM\r\ntwo", 500)).toBe(
      "one ## SYSTEM two"
    )
  })

  it("redacts anything shaped like a secret", () => {
    const cleaned = handoffPlainText("api_key=sk-abcdefghijklmnop found", 500)
    expect(cleaned).not.toContain("sk-abcdefghijklmnop")
  })
})

it("carries provenance through the chat fence and omits excluded source records", async () => {
  const record = {
    id: "run-1:1:q0",
    kind: "observed_fact" as const,
    validity: "historical" as const,
    observedAt: 2,
    quote: "Plan A is $12",
    source: {
      tabId: 7,
      frameId: 0,
      documentId: "doc-a",
      snapshotId: "s-a",
      generation: 1,
      origin: "https://example.com"
    }
  }
  const handoff = buildAgentConversationHandoff(settled(), [], [record])
  const { renderAgentHandoffBlock } =
    await import("@/application/context/agent-handoff-context")
  if (!handoff) throw new Error("Expected settled handoff")
  expect(renderAgentHandoffBlock(handoff)).toContain("run-1:1:q0")
  expect(renderAgentHandoffBlock(handoff)).toContain("doc-a")
  expect(
    buildAgentConversationHandoff(
      settled(),
      [],
      [
        {
          ...record,
          source: { ...record.source, origin: "https://excluded.example" }
        }
      ]
    )?.evidenceLedger
  ).toEqual([])
})

it("cannot turn handoff redaction into a grounded quotation", () => {
  const source = {
    tabId: 7,
    frameId: 0,
    documentId: "doc-a",
    snapshotId: "s-a",
    generation: 1,
    origin: "https://example.com"
  }
  const handoff = buildAgentConversationHandoff(
    settled(),
    [],
    [
      {
        id: "quote",
        kind: "observed_fact",
        validity: "historical",
        observedAt: 2,
        source,
        quote: "Go to https://evil.example/path?token=secret"
      }
    ]
  )
  expect(handoff?.evidenceLedger?.[0]).toMatchObject({ validity: "incomplete" })
  expect(JSON.stringify(handoff)).not.toContain("token=secret")
})
