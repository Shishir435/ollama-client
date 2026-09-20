import type { AgentModelPort } from "@ollama-client/agent-runtime"
import { describe, expect, it, vi } from "vitest"

import { withDecisionTimeout } from "../agent-run-controller"

/**
 * The provider's model port reaches the controller through two object
 * literals, and both used to rebuild it by naming the methods they wanted to
 * keep. An optional method neither named stopped existing — silently, because
 * optional means absent is legal.
 *
 * That is not hypothetical. `decisionTelemetry` was added to the port,
 * measured correctly, and proven by the port's own tests and by a real-engine
 * run, and still reported nothing through the extension, because these
 * literals dropped it on the way past. Both spread now, so the forwarding is
 * a property of the construction rather than a rule someone has to remember.
 */
describe("withDecisionTimeout", () => {
  const port = (): AgentModelPort => ({
    decide: vi.fn(async () => ({ type: "complete", summary: "done" }) as never),
    vision: vi.fn(async () => true),
    decisionTelemetry: vi.fn(() => ({ promptTokens: 42 }))
  })

  it("forwards every method the port carries", () => {
    const wrapped = withDecisionTimeout(port(), 1_000)

    expect(wrapped.decisionTelemetry?.("run-1")).toEqual({ promptTokens: 42 })
    expect(wrapped.vision).toBeTypeOf("function")
  })

  /**
   * The guard that matters: a method added to the port tomorrow has to arrive
   * without anyone editing this wrapper. Enumeration cannot promise that and
   * spreading can, so the test asks about a method this file invented.
   */
  it("forwards a method it was never told about", () => {
    const future = {
      ...port(),
      somethingAddedLater: () => "present"
    } as AgentModelPort & { somethingAddedLater(): string }

    const wrapped = withDecisionTimeout(future, 1_000) as typeof future

    expect(wrapped.somethingAddedLater()).toBe("present")
  })

  it("still replaces decide with the timeout-bounded one", async () => {
    const source = port()
    const wrapped = withDecisionTimeout(source, 1_000)

    await wrapped.decide(
      { state: { id: "run-1" } as never, observation: {} as never },
      { aborted: false }
    )

    expect(source.decide).toHaveBeenCalledTimes(1)
    expect(wrapped.decide).not.toBe(source.decide)
  })
})
