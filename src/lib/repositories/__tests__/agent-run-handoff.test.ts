import { TERMINAL_AGENT_STATUSES } from "@ollama-client/agent-runtime"
import type { AgentRunState } from "@ollama-client/contracts"
import {
  AGENT_HANDOFF_STATUSES,
  MAX_AGENT_HANDOFF_FINDINGS,
  MAX_AGENT_HANDOFF_RESULT_CHARS
} from "@ollama-client/contracts/agent-handoff"
import { describe, expect, it } from "vitest"

import {
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
