import { afterEach, describe, expect, it, vi } from "vitest"
import { portPair } from "@/test/persistence-ports"
import { MAX_DATABASE_BYTES, MAX_PAYLOAD_CHARS } from "../payload-limits"

/** Small limits exercise rejection paths without allocating enormous fixtures. */
const smallLimits = async () => {
  vi.resetModules()
  vi.doMock("../payload-limits", async (original) => ({
    ...(await original<object>()),
    MAX_PAYLOAD_CHARS: 64,
    MAX_DATABASE_BYTES: 16
  }))
  return import("../port-channel")
}

afterEach(() => {
  vi.doUnmock("../payload-limits")
  vi.resetModules()
  globalThis.__persistenceHostCall = undefined
})

describe("practical persistence payload limits", () => {
  it("leaves room for base64 and the database request envelope below engine string limits", () => {
    expect(MAX_PAYLOAD_CHARS).toBeLessThan(512 * 1024 * 1024)
    expect(Math.ceil(MAX_DATABASE_BYTES / 3) * 4 + 1024).toBeLessThan(
      MAX_PAYLOAD_CHARS
    )
  })

  it("rejects oversized serialized sends before posting a frame", async () => {
    const { makePortChannel } = await smallLimits()
    const { ports, frames } = portPair()
    const channel = makePortChannel(ports[0])
    try {
      await expect(channel.send({ text: "x".repeat(65) })).rejects.toThrow(
        "supported transfer size"
      )
      expect(frames).toHaveLength(0)
    } finally {
      channel.close()
    }
  })

  it("rejects cumulative received data before joining it and clears buffered listeners", async () => {
    const { makePortChannel } = await smallLimits()
    const { ports, messages } = portPair()
    const channel = makePortChannel(ports[0])
    ports[1].postMessage({
      kind: "data",
      seq: 0,
      text: "x".repeat(40),
      last: false
    })
    ports[1].postMessage({
      kind: "data",
      seq: 1,
      text: "x".repeat(40),
      last: true
    })
    await expect(channel.received).rejects.toThrow("supported transfer size")
    expect(messages[0].size).toBe(0)
  })

  it("reports an engine serialization overflow as a size rejection", async () => {
    const { makePortChannel } = await smallLimits()
    const { ports } = portPair()
    const channel = makePortChannel(ports[0])
    const stringify = vi.spyOn(JSON, "stringify").mockImplementationOnce(() => {
      throw new RangeError("Invalid string length")
    })
    try {
      await expect(channel.send({})).rejects.toThrow("supported transfer size")
    } finally {
      stringify.mockRestore()
      channel.close()
    }
  })

  it("rejects an oversized restore before copying or sending its bytes", async () => {
    await smallLimits()
    const { rpcImportDb } = await import("../client")
    const bytes = new Uint8Array(17)
    const slice = vi.spyOn(bytes.buffer, "slice")
    const owner = vi.fn()
    globalThis.__persistenceHostCall = owner
    await expect(rpcImportDb(bytes)).rejects.toMatchObject({
      reason: "too-large",
      retryable: false
    })
    expect(slice).not.toHaveBeenCalled()
    expect(owner).not.toHaveBeenCalled()
  })

  it("rejects oversized binary values before base64 allocation", async () => {
    await smallLimits()
    const { encodeValue } = await import("../protocol")
    expect(() => encodeValue(new Uint8Array(17))).toThrow(
      "supported transfer size"
    )
  })
})
