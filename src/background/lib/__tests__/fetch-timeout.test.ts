import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createAbortTimeout } from "@/background/lib/fetch-timeout"

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe("createAbortTimeout", () => {
  it("aborts the controller once the timeout elapses", () => {
    const controller = new AbortController()
    const t = createAbortTimeout(controller, 1000)

    expect(controller.signal.aborted).toBe(false)
    expect(t.timedOut()).toBe(false)

    vi.advanceTimersByTime(1000)

    expect(controller.signal.aborted).toBe(true)
    expect(t.timedOut()).toBe(true)
  })

  it("does not abort when cleared before the timeout", () => {
    const controller = new AbortController()
    const t = createAbortTimeout(controller, 1000)

    t.clear()
    vi.advanceTimersByTime(5000)

    expect(controller.signal.aborted).toBe(false)
    expect(t.timedOut()).toBe(false)
  })

  it("timedOut() stays false for an external abort (user cancel)", () => {
    const controller = new AbortController()
    const t = createAbortTimeout(controller, 1000)

    controller.abort() // e.g. user-initiated cancel
    expect(controller.signal.aborted).toBe(true)
    expect(t.timedOut()).toBe(false)

    t.clear()
  })
})
