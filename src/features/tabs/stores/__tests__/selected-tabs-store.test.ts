import { describe, it, expect } from "vitest"
import { renderHook, act } from "@testing-library/react"
import { useSelectedTabs } from "../selected-tabs-store"

describe("selected-tabs-store", () => {
  it("should initialize with empty state", () => {
    const { result } = renderHook(() => useSelectedTabs())

    expect(result.current.selectedTabIds).toEqual([])
    expect(result.current.errors).toEqual({})
  })

  it("should set selected tab IDs", () => {
    const { result } = renderHook(() => useSelectedTabs())

    act(() => {
      result.current.setSelectedTabIds(["tab1", "tab2"])
    })

    expect(result.current.selectedTabIds).toEqual(["tab1", "tab2"])
  })

  it("should set errors", () => {
    const { result } = renderHook(() => useSelectedTabs())
    const errors = { tab1: "Error 1", tab2: "Error 2" }

    act(() => {
      result.current.setErrors(errors)
    })

    expect(result.current.errors).toEqual(errors)
  })

  it("should update selected tabs independently", () => {
    const { result } = renderHook(() => useSelectedTabs())

    act(() => {
      result.current.setSelectedTabIds(["tab1"])
    })

    expect(result.current.selectedTabIds).toEqual(["tab1"])

    act(() => {
      result.current.setErrors({ "0": "Error" } as any)
    })

    expect(result.current.selectedTabIds).toEqual(["tab1"])
    expect(result.current.errors).toEqual({ "0": "Error" })
  })
})
