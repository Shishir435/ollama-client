import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { CancellationRegistry, createAbortTimeout } from "../cancellation"

const makeAbortable = () => {
  const state = { aborted: false }
  return {
    state,
    controller: { abort: () => (state.aborted = true) }
  }
}

describe("CancellationRegistry", () => {
  it("owns, clears, and aborts keyed handles", () => {
    const registry = new CancellationRegistry()
    const { controller, state } = makeAbortable()
    registry.set("request", controller)

    expect(registry.get("request")).toBe(controller)
    expect(registry.has("request")).toBe(true)
    expect(registry.abortAndClear("request")).toBe(true)
    expect(state.aborted).toBe(true)
    expect(registry.has("request")).toBe(false)
  })

  it("treats null as clear and missing cancellation as a no-op", () => {
    const registry = new CancellationRegistry()
    registry.set("request", makeAbortable().controller)
    registry.set("request", null)

    expect(registry.get("request")).toBeUndefined()
    expect(registry.abortAndClear("missing")).toBe(false)
  })
})

describe("createAbortTimeout", () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it("records timeout-driven cancellation", () => {
    const { controller, state } = makeAbortable()
    const timeout = createAbortTimeout(controller, 1000)
    vi.advanceTimersByTime(1000)

    expect(state.aborted).toBe(true)
    expect(timeout.timedOut()).toBe(true)
  })

  it("stays false when cleared or externally cancelled", () => {
    const cleared = makeAbortable()
    const clearedTimeout = createAbortTimeout(cleared.controller, 1000)
    clearedTimeout.clear()
    vi.advanceTimersByTime(1000)
    expect(cleared.state.aborted).toBe(false)
    expect(clearedTimeout.timedOut()).toBe(false)

    const external = makeAbortable()
    const externalTimeout = createAbortTimeout(external.controller, 1000)
    external.controller.abort()
    externalTimeout.clear()
    expect(externalTimeout.timedOut()).toBe(false)
  })
})
