import { describe, expect, it } from "vitest"
import { createRequestQueue, QueueStalledError } from "../queue.js"

const tick = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe("createRequestQueue", () => {
  it("serializes tasks", async () => {
    const queue = createRequestQueue()
    const order: string[] = []

    const first = queue(async () => {
      order.push("first:start")
      await tick(20)
      order.push("first:end")
    }, 1000)
    const second = queue(async () => {
      order.push("second:start")
    }, 1000)

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
      20,
      "cancellable"
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
      20,
      "slow"
    )
    const second = queue(async () => {
      secondStarted = true
    }, 1000)

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

    const wedged = queue(() => new Promise<void>(() => {}), 20, "wedged")
    const waiting = queue(start, 1000)

    await expect(wedged).rejects.toThrow(/timeout/)
    // Both the request already queued and one arriving later are refused: either
    // would otherwise run alongside a turn that is still live.
    await expect(waiting).rejects.toThrow(QueueStalledError)
    await expect(queue(start, 1000)).rejects.toThrow(/"wedged"/)
    expect(started).toBe(false)
  })

  it("accepts work again once the stuck task finally stops", async () => {
    const queue = createRequestQueue({ cancelGraceMs: 20 })
    let stopWedged: (() => void) | undefined

    const wedged = queue(
      () => new Promise<void>((resolve) => (stopWedged = resolve)),
      20,
      "wedged"
    )
    await expect(wedged).rejects.toThrow(/timeout/)
    await expect(queue(async () => "refused", 1000)).rejects.toThrow(
      QueueStalledError
    )

    stopWedged?.()
    await tick(150)
    await expect(queue(async () => "ran", 1000)).resolves.toBe("ran")
  })
})
