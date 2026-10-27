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

  it("waits longer between checkpoints as the reply grows, up to four intervals", async () => {
    vi.useFakeTimers()
    const write = vi.fn().mockResolvedValue(1)
    const writer = makeAssistantWriter(write)

    writer.schedule(message("x".repeat(150_000)))
    await vi.advanceTimersByTimeAsync(999)
    expect(write).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(write).toHaveBeenCalledTimes(1)

    // Longer replies do not wait longer than the cap.
    writer.schedule(message("x".repeat(900_000)))
    await vi.advanceTimersByTimeAsync(1000)
    expect(write).toHaveBeenCalledTimes(2)
  })

  it("keeps the base interval for a short reply", async () => {
    vi.useFakeTimers()
    const write = vi.fn().mockResolvedValue(1)
    const writer = makeAssistantWriter(write)

    writer.schedule(message("short"))
    await vi.advanceTimersByTimeAsync(250)

    expect(write).toHaveBeenCalledTimes(1)
  })

  it("counts reasoning text toward the growth of a reply", async () => {
    vi.useFakeTimers()
    const write = vi.fn().mockResolvedValue(1)
    const writer = makeAssistantWriter(write)

    writer.schedule({ ...message(""), thinking: "x".repeat(100_000) })
    await vi.advanceTimersByTimeAsync(500)
    expect(write).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(250)
    expect(write).toHaveBeenCalledTimes(1)
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
