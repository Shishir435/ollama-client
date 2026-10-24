import { afterEach, describe, expect, it, vi } from "vitest"
import { makeAssistantWriter } from "../assistant-writer"

const message = (content: string, done = false) => ({
  role: "assistant" as const,
  content,
  done
})
afterEach(() => vi.useRealTimers())

describe("durable assistant batching", () => {
  it("coalesces an 8000-token burst and persists the terminal snapshot", async () => {
    const write = vi.fn().mockResolvedValue(1)
    const writer = makeAssistantWriter(write)
    for (let index = 1; index <= 8000; index++)
      writer.schedule(message("x".repeat(index)))
    writer.schedule(message("x".repeat(8000), true))
    await writer.flush()
    expect(write).toHaveBeenCalledExactlyOnceWith(
      message("x".repeat(8000), true)
    )
  })

  it("checkpoints while streaming and drains the latest snapshot behind a slow write", async () => {
    vi.useFakeTimers()
    let release!: () => void
    const write = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            release = resolve
          })
      )
      .mockResolvedValue(1)
    const writer = makeAssistantWriter(write)
    writer.schedule(message("first"))
    await vi.advanceTimersByTimeAsync(250)
    writer.schedule(message("latest", true))
    const flushed = writer.flush()
    release()
    await flushed
    expect(write.mock.calls.map(([value]) => value.content)).toEqual([
      "first",
      "latest"
    ])
  })

  it("propagates persistence failure at settlement", async () => {
    vi.useFakeTimers()
    const writer = makeAssistantWriter(
      vi.fn().mockRejectedValue(new Error("disk full"))
    )
    writer.schedule(message("partial"))
    await vi.advanceTimersByTimeAsync(250)
    await expect(writer.flush()).rejects.toThrow("disk full")
  })
})
