import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  run: vi.fn(),
  deleteVectors: vi.fn()
}))

vi.mock("@/lib/sqlite/db", () => ({ query: mocks.query, run: mocks.run }))
vi.mock("../vector-store", () => ({ deleteVectors: mocks.deleteVectors }))

import { sweepVectorCleanupReceipts } from "../vector-cleanup-receipts"

describe("vector cleanup receipts", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.run.mockResolvedValue(undefined)
    mocks.deleteVectors.mockResolvedValue(0)
  })

  it("acknowledges each receipt only after its idempotent vector delete", async () => {
    mocks.query.mockResolvedValue([
      { messageId: 11, createdAt: 1 },
      { messageId: 12, createdAt: 1 }
    ])

    await expect(sweepVectorCleanupReceipts()).resolves.toBe(2)

    expect(mocks.deleteVectors.mock.calls).toEqual([
      [{ messageId: 11 }],
      [{ messageId: 12 }]
    ])
    expect(mocks.run.mock.calls).toEqual([
      ["DELETE FROM vector_cleanup_receipts WHERE messageId = ?", [11]],
      ["DELETE FROM vector_cleanup_receipts WHERE messageId = ?", [12]]
    ])
    expect(mocks.deleteVectors.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.run.mock.invocationCallOrder[0]
    )
  })

  it("leaves the receipt pending when Dexie cleanup fails", async () => {
    mocks.query.mockResolvedValue([{ messageId: 11, createdAt: 1 }])
    mocks.deleteVectors.mockRejectedValue(new Error("Dexie unavailable"))

    await expect(sweepVectorCleanupReceipts()).rejects.toThrow(
      "Dexie unavailable"
    )
    expect(mocks.run).not.toHaveBeenCalled()
  })
})
