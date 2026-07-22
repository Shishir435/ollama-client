import { beforeEach, describe, expect, it, vi } from "vitest"

import { STORAGE_KEYS } from "@/lib/constants"
import {
  clearDiagnosticEvents,
  flushDiagnosticEvents,
  getDiagnosticEvents,
  recordDiagnosticEvent
} from "../diagnostic-recorder"

const storage = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
  remove: vi.fn()
}))
const sessionStorage = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
  remove: vi.fn()
}))
vi.mock("@/lib/plasmo-global-storage", () => ({
  getPlasmoStoredValue: storage.get,
  setPlasmoStoredValue: storage.set,
  removePlasmoStoredValue: storage.remove
}))

beforeEach(async () => {
  let sessionValues: Record<string, unknown> = {}
  Object.assign(chrome.storage, { session: sessionStorage })
  sessionStorage.get.mockReset().mockImplementation(async (key: string) => ({
    [key]: sessionValues[key]
  }))
  sessionStorage.set.mockReset().mockImplementation(async (items) => {
    sessionValues = { ...sessionValues, ...items }
  })
  sessionStorage.remove.mockReset().mockImplementation(async (key: string) => {
    delete sessionValues[key]
  })
  storage.get.mockReset().mockResolvedValue([])
  storage.set.mockReset().mockResolvedValue(undefined)
  storage.remove.mockReset().mockResolvedValue(undefined)
  await clearDiagnosticEvents()
  sessionStorage.get.mockClear()
  sessionStorage.set.mockClear()
  sessionStorage.remove.mockClear()
  storage.get.mockClear()
  storage.set.mockClear()
  storage.remove.mockClear()
})

describe("diagnostic recorder", () => {
  it("stores only allowlisted technical metadata", async () => {
    await recordDiagnosticEvent({
      level: "error",
      code: "RPC_PROVIDER_FAILED",
      operation: "providers.listModels",
      surface: "background",
      metadata: {
        count: 2,
        status: "failed",
        prompt: "private prompt",
        result: "contains private words"
      }
    })
    await flushDiagnosticEvents()

    expect(storage.set).toHaveBeenCalledWith(STORAGE_KEYS.DIAGNOSTICS.EVENTS, [
      expect.objectContaining({
        metadata: { count: 2, status: "failed" }
      })
    ])
  })

  it("batches multiple events into one storage write", async () => {
    await recordDiagnosticEvent({
      level: "info",
      code: "RPC_COMPLETED",
      operation: "providers.list",
      surface: "background"
    })
    await recordDiagnosticEvent({
      level: "info",
      code: "RPC_COMPLETED",
      operation: "providers.listModels",
      surface: "background"
    })

    expect(storage.set).not.toHaveBeenCalled()
    expect(sessionStorage.set).toHaveBeenCalledTimes(2)
    await expect(getDiagnosticEvents()).resolves.toHaveLength(2)

    await flushDiagnosticEvents()
    expect(storage.set).toHaveBeenCalledOnce()
    expect(storage.set.mock.calls[0]?.[1]).toHaveLength(2)
  })

  it("serializes clear after an in-flight flush", async () => {
    let releaseWrite: (() => void) | undefined
    storage.set.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          releaseWrite = resolve
        })
    )
    await recordDiagnosticEvent({
      level: "info",
      code: "RPC_COMPLETED",
      operation: "providers.list",
      surface: "background"
    })

    const flush = flushDiagnosticEvents()
    await vi.waitFor(() => expect(storage.set).toHaveBeenCalledOnce())
    const clear = clearDiagnosticEvents()
    expect(storage.remove).not.toHaveBeenCalled()

    releaseWrite?.()
    await flush
    await clear
    expect(storage.remove).toHaveBeenCalledOnce()
    expect(storage.set.mock.invocationCallOrder[0]).toBeLessThan(
      storage.remove.mock.invocationCallOrder[0]
    )
  })

  it("keeps the pending in-memory batch small during an event burst", async () => {
    await Promise.all(
      Array.from({ length: 100 }, (_, index) =>
        recordDiagnosticEvent({
          level: "info",
          code: "RPC_COMPLETED",
          operation: `providers.test-${index}`,
          surface: "background",
          metadata: { result: "x".repeat(100) }
        })
      )
    )

    const events = await getDiagnosticEvents()
    expect(events.length).toBeLessThanOrEqual(50)
    expect(JSON.stringify(events).length).toBeLessThanOrEqual(32 * 1024)
  })

  it("drops invalid, expired, and excess records", async () => {
    const now = Date.now()
    storage.get.mockResolvedValue([
      { secret: "not an event" },
      {
        id: crypto.randomUUID(),
        at: now - 8 * 24 * 60 * 60 * 1000,
        level: "info",
        code: "OLD",
        operation: "test",
        surface: "background"
      },
      {
        id: crypto.randomUUID(),
        at: now,
        level: "info",
        code: "CURRENT",
        operation: "test",
        surface: "background"
      }
    ])

    await expect(getDiagnosticEvents(now)).resolves.toMatchObject([
      { code: "CURRENT" }
    ])
  })

  it("caps retained diagnostics by count and serialized size", async () => {
    const now = Date.now()
    storage.get.mockResolvedValue(
      Array.from({ length: 250 }, (_, index) => ({
        id: crypto.randomUUID(),
        at: now + index,
        level: "info",
        code: "RPC_COMPLETED",
        operation: "providers.listModels",
        surface: "background",
        metadata: { result: "x".repeat(1_000) }
      }))
    )

    const events = await getDiagnosticEvents(now + 250)
    expect(events.length).toBeLessThanOrEqual(200)
    expect(JSON.stringify(events).length).toBeLessThanOrEqual(128 * 1024)
    expect(events.at(-1)?.at).toBe(now + 249)
  })
})
