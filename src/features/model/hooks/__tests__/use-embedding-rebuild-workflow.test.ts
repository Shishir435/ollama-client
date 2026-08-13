import { act, renderHook } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { useEmbeddingRebuildWorkflow } from "../use-embedding-rebuild-workflow"

const mocks = vi.hoisted(() => ({
  rebuild: vi.fn(async () => undefined),
  refresh: vi.fn(async () => undefined)
}))

vi.mock("../use-embedding-dimension-stats", () => ({
  useEmbeddingDimensionStats: () => ({
    stats: { totalVectors: 2, mixedDimensions: false },
    refresh: mocks.refresh
  })
}))
vi.mock("../use-embedding-rebuild", () => ({
  useEmbeddingRebuild: () => ({
    isRebuilding: false,
    progress: null,
    error: null,
    complete: false,
    rebuild: mocks.rebuild,
    resetComplete: vi.fn()
  })
}))

describe("useEmbeddingRebuildWorkflow", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("applies a pending model without rebuilding", () => {
    const applyModelChange = vi.fn()
    const { result } = renderHook(() =>
      useEmbeddingRebuildWorkflow({ memoryEnabled: true, applyModelChange })
    )

    act(() => result.current.requestModelChange("embed-v2", "provider-2"))
    expect(result.current.modelChangeOpen).toBe(true)

    act(() => result.current.switchModel())

    expect(applyModelChange).toHaveBeenCalledWith("embed-v2", "provider-2")
    expect(mocks.rebuild).not.toHaveBeenCalled()
    expect(result.current.modelChangeOpen).toBe(false)
  })

  it("applies a pending model before rebuilding", async () => {
    const applyModelChange = vi.fn()
    const { result } = renderHook(() =>
      useEmbeddingRebuildWorkflow({ memoryEnabled: false, applyModelChange })
    )

    act(() => result.current.requestModelChange("embed-v3", "provider-3"))
    await act(() => result.current.switchModelAndRebuild())

    expect(applyModelChange).toHaveBeenCalledWith("embed-v3", "provider-3")
    expect(applyModelChange.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.rebuild.mock.invocationCallOrder[0]
    )
    expect(result.current.modelChangeOpen).toBe(false)
  })

  it("drops a pending model when the dialog closes", () => {
    const applyModelChange = vi.fn()
    const { result } = renderHook(() =>
      useEmbeddingRebuildWorkflow({ memoryEnabled: true, applyModelChange })
    )

    act(() => result.current.requestModelChange("embed-v4", "provider-4"))
    act(() => result.current.setModelChangeOpen(false))
    act(() => result.current.switchModel())

    expect(result.current.modelChangeOpen).toBe(false)
    expect(applyModelChange).not.toHaveBeenCalled()
  })
})
