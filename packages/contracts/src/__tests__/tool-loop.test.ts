import { describe, expect, it } from "vitest"
import {
  DurableToolLoopStateSchema,
  ToolLoopCheckpointEnvelopeSchema
} from "../tool-loop"

const state = {
  iteration: 1,
  phase: "tools" as const,
  taintGeneration: 2,
  workingMessages: [{ role: "user" as const, content: "hello" }],
  toolRuns: [],
  pendingToolCalls: [
    { id: "call-1", name: "search", arguments: { query: "hello" } }
  ],
  nextToolIndex: 0
}

describe("tool-loop contracts", () => {
  it("validates the versioned checkpoint envelope", () => {
    expect(
      ToolLoopCheckpointEnvelopeSchema.parse({ version: 1, state })
    ).toEqual({ version: 1, state })
  })

  it("rejects an invalid cursor before recovery", () => {
    expect(() =>
      DurableToolLoopStateSchema.parse({ ...state, nextToolIndex: -1 })
    ).toThrow()
  })

  it("rejects malformed nested tool calls", () => {
    expect(() =>
      DurableToolLoopStateSchema.parse({
        ...state,
        pendingToolCalls: [{ id: "call-1", name: "search" }]
      })
    ).toThrow()
  })
})
