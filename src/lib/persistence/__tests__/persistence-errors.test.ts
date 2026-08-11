import { afterEach, describe, expect, it, vi } from "vitest"
import { PersistenceError, PersistenceNotDeliveredError } from "../errors"
import { RETRYABLE_OPS } from "../protocol"

const SQLITE_TEXT =
  "SQLITE_CONSTRAINT: UNIQUE constraint failed: messages.content"

describe("persistence errors", () => {
  it("keeps the owner's text out of everything that gets printed", () => {
    const error = new PersistenceError({
      op: "run",
      reason: "owner-error",
      detail: SQLITE_TEXT
    })

    // `message` is what generic logging, `String(error)` and an error bubble
    // all reach for. The owner forwards SQLite verbatim, so none of it may
    // arrive there — it travels on `detail`, which a caller opts into.
    expect(error.message).not.toContain(SQLITE_TEXT)
    expect(error.message).not.toContain("messages")
    expect(String(error)).not.toContain(SQLITE_TEXT)
    expect(error.userMessage).not.toContain(SQLITE_TEXT)
    expect(error.detail).toBe(SQLITE_TEXT)
  })

  it("names the operation and the reason, because both change what to do", () => {
    const error = new PersistenceError({ op: "importDb", reason: "timeout" })

    expect(error.op).toBe("importDb")
    expect(error.reason).toBe("timeout")
    expect(error.message).toContain("importDb")
    expect(error.message).toContain("timeout")
    expect(error.userMessage).toBeTruthy()
  })

  it("treats a request that never left as safe to repeat", () => {
    const error = new PersistenceNotDeliveredError(
      "run",
      new Error("owner unavailable")
    )

    expect(error).toBeInstanceOf(PersistenceError)
    expect(error.reason).toBe("not-delivered")
    // `run` is not idempotent, and it is still retryable here — the request
    // provably never executed, so repeating it cannot double a write.
    expect(RETRYABLE_OPS.has("run")).toBe(false)
    expect(error.retryable).toBe(true)
  })

  it("refuses to repeat a write whose outcome is unknown", () => {
    // A `run` that timed out may have committed. Repeating it is the one thing
    // that turns a lost response into a duplicated row.
    expect(
      new PersistenceError({ op: "run", reason: "timeout" }).retryable
    ).toBe(false)
    expect(
      new PersistenceError({ op: "run", reason: "owner-error" }).retryable
    ).toBe(false)
    // A read is safe to repeat whatever happened to it.
    expect(
      new PersistenceError({ op: "query", reason: "timeout" }).retryable
    ).toBe(true)
  })

  it("carries the cause without putting it in the message", () => {
    const cause = new Error("offscreen document closed")
    const error = new PersistenceNotDeliveredError("query", cause)

    expect(error.cause).toBe(cause)
    expect(error.detail).toBe("offscreen document closed")
    expect(error.message).not.toContain("offscreen document closed")
  })
})

describe("in-process owner failures", () => {
  const SQL_TEXT = "SQLITE_ERROR: no such column: messages.foo"

  afterEach(() => {
    globalThis.__persistenceHostCall = undefined
    globalThis.__persistenceEnsureOwner = undefined
    vi.resetModules()
  })

  it("types a host-call rejection instead of forwarding the worker's Error", async () => {
    // Firefox MV2 runs the owner in the background page, so the context doing
    // the most persistence work is the one taking this branch. It used to
    // reject with the worker's own Error — SQLite's text as the message.
    globalThis.__persistenceHostCall = () => Promise.reject(new Error(SQL_TEXT))
    const { rpcRun, PersistenceError } = await import("../client")

    const error = await rpcRun("UPDATE messages SET foo = 1").catch(
      (thrown: unknown) => thrown
    )

    expect(error).toBeInstanceOf(PersistenceError)
    const typed = error as InstanceType<typeof PersistenceError>
    expect(typed.op).toBe("run")
    expect(typed.reason).toBe("owner-error")
    expect(typed.message).not.toContain(SQL_TEXT)
    expect(typed.detail).toBe(SQL_TEXT)
    // A write whose outcome is unknown is never repeated.
    expect(typed.retryable).toBe(false)
  })

  it("types an ensure-hook rejection for callers that ensure directly", async () => {
    globalThis.__persistenceEnsureOwner = () =>
      Promise.reject(new Error("offscreen creation blocked"))
    const { ensurePersistenceHost, PersistenceError } = await import(
      "../client"
    )

    const error = await ensurePersistenceHost().catch(
      (thrown: unknown) => thrown
    )

    expect(error).toBeInstanceOf(PersistenceError)
    expect((error as Error).message).not.toContain("offscreen creation blocked")
  })

  it("does not re-wrap an error that is already typed", async () => {
    // Imported from the same module instance the client uses: `resetModules`
    // gives the statically imported class a different identity, and comparing
    // across the two would test module wiring rather than behavior.
    const { rpcQuery, PersistenceError: Live } = await import("../client")
    const original = new Live({ op: "query", reason: "timeout" })
    globalThis.__persistenceHostCall = () => Promise.reject(original)

    // Re-wrapping would relabel a timeout as an owner error, and with it the
    // retryability the caller reads.
    await expect(rpcQuery("SELECT 1")).rejects.toBe(original)
  })
})
