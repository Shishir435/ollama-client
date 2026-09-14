import { MAX_AGENT_OBSERVATIONS } from "@ollama-client/contracts"
import { describe, expect, it } from "vitest"

import { MAX_AGENT_STEPS } from "../agent-runs"

/**
 * The row bound and the run budget are two numbers that have to agree, and
 * they were written in different files years apart. The budget moved to fifty
 * and this one stayed at twenty-five, so every long run died at step 26 with
 * "Agent run exceeds its 25-step limit" — a persistence error wearing a
 * budget's words, raised from an INSERT the controller had no way to expect.
 */
describe("agent run bounds", () => {
  it("lets the budget stop a run before the table does", () => {
    expect(MAX_AGENT_STEPS).toBeGreaterThan(MAX_AGENT_OBSERVATIONS)
  })
})
