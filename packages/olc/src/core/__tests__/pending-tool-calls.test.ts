import { afterEach, describe, expect, it, vi } from "vitest"
import { PendingToolCalls } from "../pending-tool-calls.js"

afterEach(() => {
  vi.useRealTimers()
})

describe("PendingToolCalls", () => {
  it("resolves a parked call with the client's output", async () => {
    const pending = new PendingToolCalls()
    const { callId, promise } = pending.register({
      turnId: "ses_1",
      tool: "list_tabs",
      args: { limit: 2 }
    })

    expect(pending.turnOf(callId)).toBe("ses_1")
    expect(pending.resolve(callId, '{"tabs":[]}')).toBe(true)
    await expect(promise).resolves.toBe('{"tabs":[]}')
    expect(pending.size).toBe(0)
    expect(pending.resolve(callId, "again")).toBe(false)
  })

  it("fails a call so the model sees a tool error instead of hanging", async () => {
    const pending = new PendingToolCalls()
    const { callId, promise } = pending.register({
      turnId: "ses_1",
      tool: "read_tab"
    })

    expect(pending.fail(callId, "client went away")).toBe(true)
    await expect(promise).rejects.toThrow("client went away")
  })

  it("does not expire a call while the request carrying its result is queued", async () => {
    vi.useFakeTimers()
    const pending = new PendingToolCalls({ timeoutMs: 1000 })
    const { callId, promise } = pending.register({
      turnId: "ses_1",
      tool: "read_tab"
    })

    // A request carrying this result exists but is waiting behind a turn that is
    // allowed to run far longer than the call's own deadline.
    pending.holdTurn("ses_1")
    await vi.advanceTimersByTimeAsync(5000)

    expect(pending.turnOf(callId)).toBe("ses_1")
    expect(pending.resolve(callId, '{"ok":true}')).toBe(true)
    await expect(promise).resolves.toBe('{"ok":true}')
  })

  it("re-arms a held call once the request that held it is gone", async () => {
    vi.useFakeTimers()
    const pending = new PendingToolCalls({ timeoutMs: 1000 })
    const { promise } = pending.register({ turnId: "ses_1", tool: "read_tab" })
    const assertion = expect(promise).rejects.toThrow("did not return a result")

    pending.holdTurn("ses_1")
    await vi.advanceTimersByTimeAsync(5000)
    // The request went away without resolving anything, so the deadline is the
    // question again — asked from the start, not from where it was suspended.
    pending.releaseTurn("ses_1")

    await vi.advanceTimersByTimeAsync(999)
    expect(pending.size).toBe(1)
    await vi.advanceTimersByTimeAsync(2)
    await assertion
    expect(pending.size).toBe(0)
  })

  it("times a call out rather than blocking an OpenCode turn forever", async () => {
    vi.useFakeTimers()
    const pending = new PendingToolCalls({ timeoutMs: 1000 })
    const { promise } = pending.register({
      turnId: "ses_1",
      tool: "read_tab"
    })
    const assertion = expect(promise).rejects.toThrow(
      "Client did not return a result for read_tab within 1000ms"
    )
    await vi.advanceTimersByTimeAsync(1000)
    await assertion
    expect(pending.size).toBe(0)
  })

  it("claims each call for announcement exactly once, oldest first", () => {
    const pending = new PendingToolCalls()
    const first = pending.register({ turnId: "ses_1", tool: "a" })
    pending.register({ turnId: "ses_2", tool: "other" })

    expect(
      pending
        .claimUnemitted("ses_1")
        .map((call: { callId: string }) => call.callId)
    ).toEqual([first.callId])
    expect(pending.claimUnemitted("ses_1")).toEqual([])

    const second = pending.register({ turnId: "ses_1", tool: "b" })
    expect(
      pending
        .claimUnemitted("ses_1")
        .map((call: { callId: string }) => call.callId)
    ).toEqual([second.callId])
  })

  it("separates announced calls from new ones, so a resume is not a suspension", () => {
    const pending = new PendingToolCalls()
    const { callId } = pending.register({ turnId: "ses_1", tool: "a" })

    expect(pending.hasUnemitted("ses_1")).toBe(true)
    pending.claimUnemitted("ses_1")
    expect(pending.hasUnemitted("ses_1")).toBe(false)
    expect(pending.hasPending("ses_1")).toBe(true)

    pending.register({ turnId: "ses_1", tool: "b" })
    expect(pending.hasUnemitted("ses_1")).toBe(true)
    pending.resolve(callId, "done")
  })

  it("notifies a watcher so an open stream can suspend on the first call", () => {
    const pending = new PendingToolCalls()
    const seen: string[] = []
    const unwatch = pending.watch("ses_1", (callId: string) =>
      seen.push(callId)
    )

    const { callId } = pending.register({ turnId: "ses_1", tool: "a" })
    pending.register({ turnId: "ses_2", tool: "b" })
    expect(seen).toEqual([callId])

    unwatch()
    pending.register({ turnId: "ses_1", tool: "c" })
    expect(seen).toEqual([callId])
  })

  it("fails every call of a session when its turn is abandoned", async () => {
    const pending = new PendingToolCalls()
    const first = pending.register({ turnId: "ses_1", tool: "a" })
    const second = pending.register({ turnId: "ses_1", tool: "b" })
    const other = pending.register({ turnId: "ses_2", tool: "c" })

    pending.failTurn("ses_1", "abandoned")
    await expect(first.promise).rejects.toThrow("abandoned")
    await expect(second.promise).rejects.toThrow("abandoned")
    expect(pending.hasPending("ses_1")).toBe(false)
    expect(pending.hasPending("ses_2")).toBe(true)
    pending.fail(other.callId, "cleanup")
    await expect(other.promise).rejects.toThrow("cleanup")
  })
})
