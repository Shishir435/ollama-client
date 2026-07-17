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

  it("fails closed when navigator.locks is unavailable", async () => {
    vi.stubGlobal("navigator", {})

    await expect(
      withStorageWriteLock("same", async () => "never runs")
    ).rejects.toThrow("Cross-context storage locking is unavailable")
  })
})
