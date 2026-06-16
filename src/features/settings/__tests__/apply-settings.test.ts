import { beforeEach, describe, expect, it, vi } from "vitest"

const store = new Map<string, unknown>()
vi.mock("@/lib/plasmo-global-storage", () => ({
  getPlasmoStoredValue: vi.fn(async (key: string) => store.get(key)),
  setPlasmoStoredValue: vi.fn(async (key: string, value: unknown) => {
    store.set(key, value)
  })
}))

import { applyStorageWrites } from "../apply-settings"

describe("applyStorageWrites", () => {
  beforeEach(() => {
    store.clear()
    vi.clearAllMocks()
  })

  it("writes a scalar key directly", async () => {
    await applyStorageWrites([
      { storageKey: "chat-grounded-only-mode", value: true }
    ])
    expect(store.get("chat-grounded-only-mode")).toBe(true)
  })

  it("merges field writes into the existing config object, preserving siblings", async () => {
    store.set("embeddings-config", { chunkSize: 500, batchSize: 5, keepMe: 1 })
    await applyStorageWrites([
      { storageKey: "embeddings-config", field: "chunkSize", value: 800 },
      { storageKey: "embeddings-config", field: "useReranking", value: false }
    ])
    expect(store.get("embeddings-config")).toEqual({
      chunkSize: 800,
      batchSize: 5,
      keepMe: 1,
      useReranking: false
    })
  })

  it("creates the config object when none exists", async () => {
    await applyStorageWrites([
      { storageKey: "embeddings-config", field: "chunkSize", value: 200 }
    ])
    expect(store.get("embeddings-config")).toEqual({ chunkSize: 200 })
  })

  it("groups writes so each key is written once", async () => {
    const { setPlasmoStoredValue } = await import("@/lib/plasmo-global-storage")
    await applyStorageWrites([
      { storageKey: "a", value: 1 },
      { storageKey: "embeddings-config", field: "x", value: 1 },
      { storageKey: "embeddings-config", field: "y", value: 2 }
    ])
    // one write for "a", one for "embeddings-config"
    expect(setPlasmoStoredValue).toHaveBeenCalledTimes(2)
    expect(store.get("embeddings-config")).toEqual({ x: 1, y: 2 })
  })

  it("rejects mixed scalar and field writes for the same key", async () => {
    const { setPlasmoStoredValue } = await import("@/lib/plasmo-global-storage")

    await expect(
      applyStorageWrites([
        { storageKey: "embeddings-config", field: "chunkSize", value: 800 },
        { storageKey: "embeddings-config", value: { chunkSize: 200 } }
      ])
    ).rejects.toThrow(
      'Cannot mix scalar and field settings writes for storage key "embeddings-config"'
    )
    expect(setPlasmoStoredValue).not.toHaveBeenCalled()
  })
})
