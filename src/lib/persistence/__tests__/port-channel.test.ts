import { describe, expect, it, vi } from "vitest"
import { portPair } from "@/test/persistence-ports"
import { BYTES_PER_FRAME, FRAME_CHARS, makePortChannel } from "../port-channel"

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

  describe("trailing bytes", () => {
    const sample = (length: number) =>
      Uint8Array.from({ length }, (_, index) => (index * 31 + 7) & 255)

    it("carries a database after its message without building one string", async () => {
      const { ports, frames } = portPair()
      const sender = makePortChannel(ports[0])
      const receiver = makePortChannel(ports[1])
      const database = sample(BYTES_PER_FRAME * 3 + 1234)

      await sender.send({ op: "importDb" }, database)

      expect(await receiver.received).toEqual({ op: "importDb" })
      const received = await receiver.bytes
      expect(received).toEqual(database)
      expect(
        frames.every(
          (frame: any) =>
            frame.kind === "ack" || frame.text.length <= FRAME_CHARS
        )
      ).toBe(true)
      expect(
        frames.filter((frame: any) => frame.kind === "bytes")
      ).toHaveLength(4)
      sender.close()
      receiver.close()
    })

    it("handles a payload that is an exact multiple of the frame size and a single byte", async () => {
      for (const length of [BYTES_PER_FRAME * 2, 1]) {
        const { ports } = portPair()
        const sender = makePortChannel(ports[0])
        const receiver = makePortChannel(ports[1])
        const payload = sample(length)

        await sender.send({ ok: true }, payload)

        expect(await receiver.bytes).toEqual(payload)
        sender.close()
        receiver.close()
      }
    })

    it("resolves bytes as undefined when nothing follows the message", async () => {
      const { ports } = portPair()
      const sender = makePortChannel(ports[0])
      const receiver = makePortChannel(ports[1])

      await sender.send({ op: "ping" })

      expect(await receiver.bytes).toBeUndefined()
      sender.close()
      receiver.close()
    })

    it("refuses a bytes frame with no announced payload, a wrong last flag, and an overflow", async () => {
      const header = {
        kind: "data",
        seq: 0,
        text: "{}",
        last: true,
        bytes: 4
      }
      for (const frames of [
        [{ kind: "bytes", seq: 0, text: "AAAA", last: true }],
        [header, { kind: "bytes", seq: 1, text: "AAAA", last: true }],
        [header, { kind: "bytes", seq: 1, text: "AAAAAAAA", last: true }],
        [header, { kind: "data", seq: 1, text: "{}", last: true }]
      ]) {
        const { ports } = portPair()
        const channel = makePortChannel(ports[0])
        for (const frame of frames) ports[1].postMessage(frame)
        await expect(channel.bytes).rejects.toThrow("Invalid persistence")
      }
    })

    it("refuses a bytes count that is not a positive integer or is announced on a non-final frame", async () => {
      for (const frame of [
        { kind: "data", seq: 0, text: "{}", last: true, bytes: 0 },
        { kind: "data", seq: 0, text: "{}", last: true, bytes: 1.5 },
        { kind: "data", seq: 0, text: "{", last: false, bytes: 4 }
      ]) {
        const { ports } = portPair()
        const channel = makePortChannel(ports[0])
        ports[1].postMessage(frame)
        await expect(channel.received).rejects.toThrow("Invalid persistence")
      }
    })

    it("rejects a pending bytes promise when the port disconnects mid-transfer", async () => {
      const { ports } = portPair()
      const receiver = makePortChannel(ports[0])
      ports[1].postMessage({
        kind: "data",
        seq: 0,
        text: "{}",
        last: true,
        bytes: BYTES_PER_FRAME * 2
      })
      await receiver.received
      ports[1].disconnect()
      await expect(receiver.bytes).rejects.toThrow("disconnected")
    })
  })
})
