import { beforeEach, describe, expect, it, vi } from "vitest"
import { portPair } from "@/test/persistence-ports"
import { makePortChannel } from "../port-channel"

/**
 * Retry policy at the persistence client (H2). The rule is about evidence, not
 * optimism: an operation the owner provably never received may be repeated
 * whatever it is, and an operation whose commit outcome is unknown may not.
 */

const sendMessage = vi.fn()
const connect = vi.fn()

vi.mock("@/lib/browser-api", () => ({
  browser: {
    runtime: {
      sendMessage: (message: unknown) => sendMessage(message),
      connect: () => connect()
    }
  }
}))

const loadClient = async () => {
  vi.resetModules()
  return import("../client")
}

beforeEach(() => {
  vi.clearAllMocks()
  globalThis.__persistenceHostCall = undefined
  globalThis.__persistenceEnsureOwner = undefined
  connect.mockImplementation(() => {
    const { ports } = portPair()
    const owner = makePortChannel(ports[1])
    void owner.received.then(async (message) => {
      try {
        await owner.send(await sendMessage(message))
      } catch {
        ports[1].disconnect()
      }
    })
    return ports[0]
  })
  sendMessage.mockResolvedValue({ ok: true, result: { changes: 1 } })
})

describe("persistence client delivery", () => {
  it("does not repeat a failed backup export", async () => {
    globalThis.__persistenceEnsureOwner = vi.fn().mockResolvedValue(undefined)
    sendMessage.mockRejectedValue(new Error("export is still in flight"))
    const { rpcExportDb } = await loadClient()
    await expect(rpcExportDb()).rejects.toThrow(/owner-error/)
    expect(sendMessage).toHaveBeenCalledTimes(1)
  })

  it("retries a failed connection before any request bytes were sent", async () => {
    globalThis.__persistenceEnsureOwner = vi.fn().mockResolvedValue(undefined)
    connect.mockImplementationOnce(() => {
      throw new Error("owner unavailable")
    })
    const { rpcRun } = await loadClient()
    await expect(rpcRun("UPDATE messages SET done = 1")).resolves.toEqual({
      changes: 1
    })
    expect(sendMessage).toHaveBeenCalledOnce()
  })

  it("repeats a write the owner never received", async () => {
    const ensure = vi
      .fn()
      .mockRejectedValueOnce(new Error("owner is still starting"))
      .mockResolvedValue(undefined)
    globalThis.__persistenceEnsureOwner = ensure

    const { rpcRun } = await loadClient()
    const result = await rpcRun("INSERT INTO sessions (id) VALUES (?)", ["a"])

    expect(result).toEqual({ changes: 1 })
    expect(ensure).toHaveBeenCalledTimes(2)
    // The failed attempt never sent anything, so the write happened once.
    expect(sendMessage).toHaveBeenCalledTimes(1)
  })

  it("does not repeat a write whose outcome is unknown", async () => {
    globalThis.__persistenceEnsureOwner = vi.fn().mockResolvedValue(undefined)
    sendMessage.mockRejectedValue(new Error("owner died mid-request"))

    const { rpcRun } = await loadClient()

    await expect(
      rpcRun("INSERT INTO sessions (id) VALUES (?)", ["a"])
    ).rejects.toThrow(/owner-error/)
    expect(sendMessage).toHaveBeenCalledTimes(1)
  })

  it("still repeats an idempotent op whose outcome is unknown", async () => {
    globalThis.__persistenceEnsureOwner = vi.fn().mockResolvedValue(undefined)
    sendMessage
      .mockRejectedValueOnce(new Error("owner died mid-request"))
      .mockResolvedValue({ ok: true, result: [] })

    const { rpcQuery } = await loadClient()

    await expect(rpcQuery("SELECT 1")).resolves.toEqual([])
    expect(sendMessage).toHaveBeenCalledTimes(2)
  })
})
