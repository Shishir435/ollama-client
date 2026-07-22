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
vi.mock("@/lib/plasmo-global-storage", () => ({
  getPlasmoStoredValue: storage.get,
  setPlasmoStoredValue: storage.set,
  removePlasmoStoredValue: storage.remove
}))

beforeEach(async () => {
  await clearDiagnosticEvents()
  storage.get.mockReset().mockResolvedValue([])
  storage.set.mockReset().mockResolvedValue(undefined)
  storage.remove.mockReset().mockResolvedValue(undefined)
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
    await expect(getDiagnosticEvents()).resolves.toHaveLength(2)

    await flushDiagnosticEvents()
    expect(storage.set).toHaveBeenCalledOnce()
    expect(storage.set.mock.calls[0]?.[1]).toHaveLength(2)
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
