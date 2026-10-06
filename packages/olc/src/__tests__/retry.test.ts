import { describe, expect, it, vi } from "vitest"
import { createRetryAsync, isUndeliveredError } from "../util.js"

const failingWith = (code: string, calls = 1) => {
  let attempt = 0
  return vi.fn(async () => {
    attempt += 1
    if (attempt <= calls) {
      throw Object.assign(new Error(`connect ${code}`), { code })
    }
    return "ok"
  })
}

describe("retryAsync", () => {
  const retryAsync = createRetryAsync({ retries: 2, delayMs: 0 })

  it("retries an idempotent read after a reset", async () => {
    const operation = failingWith("ECONNRESET")
    await expect(retryAsync(operation)).resolves.toBe("ok")
    expect(operation).toHaveBeenCalledTimes(2)
  })

  /**
   * A reset can follow delivery: retrying `promptAsync` after one ran the
   * model twice, and retrying `session.create` left a session nobody deleted.
   */
  it("does not retry work-starting calls after an error that may follow delivery", async () => {
    const operation = failingWith("ECONNRESET")
    await expect(retryAsync(operation, { idempotent: false })).rejects.toThrow(
      "ECONNRESET"
    )
    expect(operation).toHaveBeenCalledTimes(1)
  })

  it("still retries work-starting calls the server provably never received", async () => {
    const operation = failingWith("ECONNREFUSED")
    await expect(retryAsync(operation, { idempotent: false })).resolves.toBe(
      "ok"
    )
    expect(operation).toHaveBeenCalledTimes(2)
  })
})

describe("isUndeliveredError", () => {
  it("accepts only a refused connection", () => {
    expect(isUndeliveredError({ code: "ECONNREFUSED" })).toBe(true)
    expect(
      isUndeliveredError(
        new Error("fetch failed", { cause: { code: "ECONNREFUSED" } })
      )
    ).toBe(true)
    expect(isUndeliveredError({ code: "ECONNRESET" })).toBe(false)
    expect(isUndeliveredError(new Error("socket hang up"))).toBe(false)
    expect(isUndeliveredError(null)).toBe(false)
  })
})
