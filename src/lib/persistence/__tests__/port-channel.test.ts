import { describe, expect, it, vi } from "vitest"
import { portPair } from "@/test/persistence-ports"
import { FRAME_CHARS, makePortChannel } from "../port-channel"

describe("persistence data channel", () => {
  it("round trips a payload above Chrome's 64 MiB message limit in bounded frames", async () => {
    const { ports, frames, messages } = portPair()
    const client = makePortChannel(ports[0])
    const owner = makePortChannel(ports[1])
    const payload = "x".repeat(65 * 1024 * 1024)
    await owner.send({ payload })
    expect(await client.received).toEqual({ payload })
    expect(
      frames
        .filter((frame: any) => frame.kind === "data")
        .every((frame: any) => frame.text.length <= FRAME_CHARS)
    ).toBe(true)
    client.close()
    owner.close()
    expect(messages.every((listeners) => listeners.size === 0)).toBe(true)
  })

  it("refuses out-of-order and oversized frames", async () => {
    for (const frame of [
      { kind: "data", seq: 1, text: "{}", last: true },
      { kind: "data", seq: 0, text: "x".repeat(FRAME_CHARS + 1), last: true }
    ]) {
      const { ports } = portPair()
      const channel = makePortChannel(ports[0])
      ports[1].postMessage(frame)
      await expect(channel.received).rejects.toThrow("Invalid persistence")
    }
  })

  it("rejects a sender waiting for acknowledgement when disconnected", async () => {
    const { ports } = portPair()
    const channel = makePortChannel(ports[0])
    const sending = channel.send({ pending: true })
    ports[1].disconnect()
    await expect(sending).rejects.toThrow("disconnected")
    await expect(channel.received).rejects.toThrow("disconnected")
  })

  it("times out and clears listeners", async () => {
    vi.useFakeTimers()
    try {
      const { ports, messages } = portPair()
      const channel = makePortChannel(ports[0], 10)
      await vi.advanceTimersByTimeAsync(11)
      await expect(channel.received).rejects.toThrow("timed out")
      expect(messages[0].size).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })
})
