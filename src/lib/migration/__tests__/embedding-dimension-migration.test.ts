import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  count: vi.fn(),
  toArray: vi.fn(),
  get: vi.fn(),
  put: vi.fn(),
  transaction: vi.fn(),
  statsGet: vi.fn(),
  statsPut: vi.fn(),
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
      get: mocks.get,
      put: mocks.put
    },
    vectorStats: { get: mocks.statsGet, put: mocks.statsPut },
    transaction: mocks.transaction
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
    mocks.get.mockImplementation(async (id: number) =>
      id === 1
        ? { id: 1, embedding: [0.1, 0.2], metadata: {} }
        : { id: 2, embedding: [0.3, 0.4], metadata: {} }
    )
    mocks.statsGet.mockResolvedValue({
      id: "totals",
      totalVectors: 2,
      totalBytes: 220,
      byType: {}
    })
    mocks.statsPut.mockResolvedValue(undefined)
    mocks.transaction.mockImplementation(
      async (_mode: unknown, ...args: unknown[]) => {
        const work = args.at(-1) as () => Promise<unknown>
        return work()
      }
    )
  })

  it("finishes the current vector write, then acknowledges abort before another mutation", async () => {
    let releaseUpdate: () => void = () => undefined
    const updateGate = new Promise<void>((resolve) => {
      releaseUpdate = resolve
    })
    mocks.put.mockImplementationOnce(async () => updateGate)
    const controller = new AbortController()

    const migration = runEmbeddingDimensionMigration(controller.signal)
    await vi.waitFor(() => expect(mocks.put).toHaveBeenCalledOnce())

    controller.abort()
    releaseUpdate()

    await expect(migration).rejects.toMatchObject({ name: "AbortError" })
    expect(mocks.put).toHaveBeenCalledOnce()
    expect(mocks.setStored).not.toHaveBeenCalled()
    expect(mocks.removeStored).not.toHaveBeenCalled()
  })
})
