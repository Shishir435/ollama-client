import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { CancellationRegistry, createAbortTimeout } from "./cancellation"

describe("CancellationRegistry", () => {
  it("owns, clears, and aborts keyed handles", () => {
    const registry = new CancellationRegistry<AbortController>()
    const controller = new AbortController()
    registry.set("request", controller)

    expect(registry.get("request")).toBe(controller)
    expect(registry.has("request")).toBe(true)
    expect(registry.abortAndClear("request")).toBe(true)
    expect(controller.signal.aborted).toBe(true)
    expect(registry.has("request")).toBe(false)
  })

  it("treats null as clear and missing cancellation as a no-op", () => {
    const registry = new CancellationRegistry<AbortController>()
    registry.set("request", new AbortController())
    registry.set("request", null)

    expect(registry.get("request")).toBeUndefined()
    expect(registry.abortAndClear("missing")).toBe(false)
  })
})

describe("createAbortTimeout", () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it("records timeout-driven cancellation", () => {
    const controller = new AbortController()
    const timeout = createAbortTimeout(controller, 1000)
    vi.advanceTimersByTime(1000)

    expect(controller.signal.aborted).toBe(true)
    expect(timeout.timedOut()).toBe(true)
  })

  it("stays false when cleared or externally cancelled", () => {
    const cleared = new AbortController()
    const clearedTimeout = createAbortTimeout(cleared, 1000)
    clearedTimeout.clear()
    vi.advanceTimersByTime(1000)
    expect(cleared.signal.aborted).toBe(false)
    expect(clearedTimeout.timedOut()).toBe(false)

    const external = new AbortController()
    const externalTimeout = createAbortTimeout(external, 1000)
    external.abort()
    externalTimeout.clear()
    expect(externalTimeout.timedOut()).toBe(false)
  })
})
