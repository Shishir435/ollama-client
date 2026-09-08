import { describe, expect, it } from "vitest"
import {
  ClientClosedError,
  createRequestQueue,
  QueueStalledError
} from "../queue.js"

const tick = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe("createRequestQueue", () => {
  it("serializes tasks", async () => {
    const queue = createRequestQueue()
    const order: string[] = []

    const first = queue(
      async () => {
        order.push("first:start")
        await tick(20)
        order.push("first:end")
      },
      { timeoutMs: 1000 }
    )
    const second = queue(
      async () => {
        order.push("second:start")
      },
      { timeoutMs: 1000 }
    )

    await Promise.all([first, second])
    expect(order).toEqual(["first:start", "first:end", "second:start"])
  })

  it("cancels a timed-out task rather than abandoning it", async () => {
    const queue = createRequestQueue()
    let observed: AbortSignal | undefined

    const settled = queue(
      async (signal) => {
        observed = signal
        await new Promise<void>((resolve) =>
          signal.addEventListener("abort", () => resolve(), { once: true })
        )
      },
      { timeoutMs: 20, label: "cancellable" }
    )

    await expect(settled).rejects.toThrow("Request timeout after 20ms")
    expect(observed?.aborted).toBe(true)
  })

  it("holds the slot until a cancelled task unwinds", async () => {
    const queue = createRequestQueue({ cancelGraceMs: 10_000 })
    let releaseFirst: (() => void) | undefined
    let secondStarted = false

    const first = queue(
      () => new Promise<void>((resolve) => (releaseFirst = resolve)),
      { timeoutMs: 20, label: "slow" }
    )
    const second = queue(
      async () => {
        secondStarted = true
      },
      { timeoutMs: 1000 }
    )

    await expect(first).rejects.toThrow(/timeout/)
    await tick(50)
    // The caller has its error, but the task is still running: starting the next
    // one here is exactly the overlap the queue exists to prevent.
    expect(secondStarted).toBe(false)

    releaseFirst?.()
    await second
    expect(secondStarted).toBe(true)
  })

  it("refuses work rather than overtaking a task that will not stop", async () => {
    const queue = createRequestQueue({ cancelGraceMs: 20 })
    let started = false
    const start = async () => {
      started = true
    }

    const wedged = queue(() => new Promise<void>(() => {}), {
      timeoutMs: 20,
      label: "wedged"
    })
    const waiting = queue(start, { timeoutMs: 1000 })

    await expect(wedged).rejects.toThrow(/timeout/)
    // Both the request already queued and one arriving later are refused: either
    // would otherwise run alongside a turn that is still live.
    await expect(waiting).rejects.toThrow(QueueStalledError)
    await expect(queue(start, { timeoutMs: 1000 })).rejects.toThrow(/"wedged"/)
    expect(started).toBe(false)
  })

  it("accepts work again once the stuck task finally stops", async () => {
    const queue = createRequestQueue({ cancelGraceMs: 20 })
    let stopWedged: (() => void) | undefined

    const wedged = queue(
      () => new Promise<void>((resolve) => (stopWedged = resolve)),
      { timeoutMs: 20, label: "wedged" }
    )
    await expect(wedged).rejects.toThrow(/timeout/)
    await expect(
      queue(async () => "refused", { timeoutMs: 1000 })
    ).rejects.toThrow(QueueStalledError)

    stopWedged?.()
    await tick(150)
    await expect(queue(async () => "ran", { timeoutMs: 1000 })).resolves.toBe(
      "ran"
    )
  })

  it("never starts a request whose client left the queue", async () => {
    const queue = createRequestQueue()
    const controller = new AbortController()
    let releaseFirst: (() => void) | undefined
    let secondStarted = false

    const first = queue(
      () => new Promise<void>((resolve) => (releaseFirst = resolve)),
      { timeoutMs: 1000, label: "holding" }
    )
    const second = queue(
      async () => {
        secondStarted = true
      },
      { timeoutMs: 1000, label: "abandoned", signal: controller.signal }
    )

    controller.abort()
    await expect(second).rejects.toThrow(ClientClosedError)
    releaseFirst?.()
    await first
    await tick(150)
    expect(secondStarted).toBe(false)
  })

  it("refuses a request whose client had already left", async () => {
    const queue = createRequestQueue()
    const controller = new AbortController()
    controller.abort()
    let started = false

    await expect(
      queue(
        async () => {
          started = true
        },
        { label: "gone", signal: controller.signal }
      )
    ).rejects.toThrow(/"gone"/)
    expect(started).toBe(false)
  })

  it("cancels a running request whose client left, and holds the slot", async () => {
    const queue = createRequestQueue({ cancelGraceMs: 10_000 })
    const controller = new AbortController()
    let observed: AbortSignal | undefined
    let release: (() => void) | undefined
    let nextStarted = false

    const running = queue(
      (signal) => {
        observed = signal
        return new Promise<void>((resolve) => (release = resolve))
      },
      { timeoutMs: 1000, label: "streaming", signal: controller.signal }
    )
    await tick(10)
    controller.abort()

    await expect(running).rejects.toThrow(ClientClosedError)
    expect(observed?.aborted).toBe(true)

    const next = queue(
      async () => {
        nextStarted = true
      },
      { timeoutMs: 1000 }
    )
    await tick(50)
    // The abandoned task is still inside the boundary until it unwinds.
    expect(nextStarted).toBe(false)
    release?.()
    await next
    expect(nextStarted).toBe(true)
  })

  it("does not cancel a request whose response merely finished", async () => {
    const queue = createRequestQueue()
    const controller = new AbortController()

    await expect(
      queue(async () => "done", {
        timeoutMs: 1000,
        signal: controller.signal
      })
    ).resolves.toBe("done")
    // A signal aborted after the task settled must not reach a later request.
    controller.abort()
    await expect(queue(async () => "next", { timeoutMs: 1000 })).resolves.toBe(
      "next"
    )
  })
})
