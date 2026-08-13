import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  count: vi.fn(),
  toArray: vi.fn(),
  update: vi.fn(),
  getStored: vi.fn(),
  setStored: vi.fn(),
  removeStored: vi.fn()
}))

vi.mock("@/lib/embeddings/db", () => ({
  vectorDb: {
    vectors: {
      count: mocks.count,
      orderBy: () => ({
        offset: () => ({
          limit: () => ({ toArray: mocks.toArray })
        })
      }),
      update: mocks.update
    }
  }
}))

vi.mock("@/lib/plasmo-global-storage", () => ({
  getPlasmoStoredValue: mocks.getStored,
  setPlasmoStoredValue: mocks.setStored,
  removePlasmoStoredValue: mocks.removeStored
}))

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn() }
}))

import { runEmbeddingDimensionMigration } from "../embedding-dimension-migration"

describe("embedding dimension migration cancellation", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getStored.mockResolvedValue(undefined)
    mocks.count.mockResolvedValue(2)
    mocks.toArray.mockResolvedValue([
      { id: 1, embedding: [0.1, 0.2], metadata: {} },
      { id: 2, embedding: [0.3, 0.4], metadata: {} }
    ])
  })

  it("finishes the current vector write, then acknowledges abort before another mutation", async () => {
    let releaseUpdate: () => void = () => undefined
    const updateGate = new Promise<void>((resolve) => {
      releaseUpdate = resolve
    })
    mocks.update.mockImplementationOnce(async () => updateGate)
    const controller = new AbortController()

    const migration = runEmbeddingDimensionMigration(controller.signal)
    for (let tick = 0; tick < 10; tick += 1) await Promise.resolve()
    expect(mocks.update).toHaveBeenCalledOnce()

    controller.abort()
    releaseUpdate()

    await expect(migration).rejects.toMatchObject({ name: "AbortError" })
    expect(mocks.update).toHaveBeenCalledOnce()
    expect(mocks.setStored).not.toHaveBeenCalled()
    expect(mocks.removeStored).not.toHaveBeenCalled()
  })
})
