import { act, renderHook, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { useEmbeddingStorageMaintenance } from "../use-embedding-storage-maintenance"

const mocks = vi.hoisted(() => ({
  toast: vi.fn(),
  getCacheStats: vi.fn(() => ({ size: 3, maxSize: 100 })),
  getStorageStats: vi.fn(async () => ({
    totalVectors: 5,
    totalSizeMB: 1.5,
    byType: { chat: 4, file: 1 }
  })),
  removeDuplicateVectors: vi.fn(async () => ({ deleted: 2, kept: 3 })),
  clearAllVectors: vi.fn(async () => 4)
}))

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mocks.toast })
}))
vi.mock("@/application/embeddings/embedding-service", () => ({
  getCacheStats: mocks.getCacheStats
}))
vi.mock("@/lib/embeddings/vector-store", () => ({
  getStorageStats: mocks.getStorageStats,
  removeDuplicateVectors: mocks.removeDuplicateVectors,
  clearAllVectors: mocks.clearAllVectors
}))
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

describe("useEmbeddingStorageMaintenance", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("loads storage and cache statistics", async () => {
    const { result } = renderHook(() =>
      useEmbeddingStorageMaintenance({ onStoreChanged: vi.fn() })
    )

    await waitFor(() => expect(result.current.storageStats).not.toBeNull())

    expect(result.current.storageStats).toMatchObject({
      totalVectors: 5,
      byType: { chat: 4, file: 1 }
    })
    expect(result.current.cacheStats).toEqual({ size: 3, maxSize: 100 })
  })

  it("clears only chat vectors and refreshes dependent statistics", async () => {
    const onStoreChanged = vi.fn(async () => undefined)
    const { result } = renderHook(() =>
      useEmbeddingStorageMaintenance({ onStoreChanged })
    )
    await waitFor(() => expect(result.current.storageStats).not.toBeNull())

    await act(() => result.current.runMaintenance("clearChat"))

    expect(mocks.clearAllVectors).toHaveBeenCalledWith("chat")
    expect(onStoreChanged).toHaveBeenCalledOnce()
    expect(mocks.toast).toHaveBeenCalledWith({
      title: "model.embedding_config.database_management.clear_chat_success"
    })
  })

  it("reports maintenance failures without refreshing", async () => {
    mocks.removeDuplicateVectors.mockRejectedValueOnce(new Error("broken"))
    const onStoreChanged = vi.fn()
    const { result } = renderHook(() =>
      useEmbeddingStorageMaintenance({ onStoreChanged })
    )
    await waitFor(() => expect(result.current.storageStats).not.toBeNull())

    await act(() => result.current.runMaintenance("removeDuplicates"))

    expect(onStoreChanged).not.toHaveBeenCalled()
    expect(mocks.toast).toHaveBeenCalledWith({
      title:
        "model.embedding_config.database_management.remove_duplicates_error",
      variant: "destructive"
    })
  })
})
