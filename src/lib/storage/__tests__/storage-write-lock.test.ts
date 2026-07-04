import { afterEach, describe, expect, it, vi } from "vitest"

import { withStorageWriteLock } from "../storage-write-lock"

describe("withStorageWriteLock", () => {
  afterEach(() => {
    // Restore any navigator.locks stub between cases.
    vi.unstubAllGlobals()
  })

  it("routes through navigator.locks when available", async () => {
    const request = vi.fn(async (_name: string, cb: () => Promise<unknown>) =>
      cb()
    )
    vi.stubGlobal("navigator", { locks: { request } })

    const result = await withStorageWriteLock("k", async () => 42)

    expect(result).toBe(42)
    expect(request).toHaveBeenCalledWith("k", expect.any(Function))
  })

  it("falls back to an in-process queue that serializes writes", async () => {
    // No navigator.locks → in-process queue path.
    vi.stubGlobal("navigator", {})

    const order: string[] = []
    const makeOp = (id: string) => async () => {
      order.push(`start:${id}`)
      await Promise.resolve()
      await Promise.resolve()
      order.push(`end:${id}`)
    }

    await Promise.all([
      withStorageWriteLock("same", makeOp("a")),
      withStorageWriteLock("same", makeOp("b"))
    ])

    // Serialized: a fully completes before b starts.
    expect(order).toEqual(["start:a", "end:a", "start:b", "end:b"])
  })

  it("keeps the queue alive after a rejecting operation", async () => {
    vi.stubGlobal("navigator", {})

    await expect(
      withStorageWriteLock("chain", async () => {
        throw new Error("boom")
      })
    ).rejects.toThrow("boom")

    // A later write on the same lock still runs.
    await expect(withStorageWriteLock("chain", async () => "ok")).resolves.toBe(
      "ok"
    )
  })
})
