import { describe, it, expect, beforeEach, vi, beforeAll } from "vitest"
import { renderHook, act } from "@testing-library/react"
import type { useThemeStore as UseThemeStoreType } from "../theme"

// Mock plasmo storage
vi.mock("@/lib/plasmo-global-storage", () => ({
  plasmoGlobalStorage: {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined)
  }
}))

// Mock chrome
const mockChrome = {
  storage: {
    onChanged: {
      addListener: vi.fn()
    }
  }
}
globalThis.chrome = mockChrome as any

describe("theme store", () => {
  let useThemeStore: typeof UseThemeStoreType

  beforeAll(async () => {
    const mod = await import("../theme")
    useThemeStore = mod.useThemeStore
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("should initialize with system theme", () => {
    const { result } = renderHook(() => useThemeStore())

    expect(result.current.theme).toBe("system")
  })

  it("should set theme to light", () => {
    const { result } = renderHook(() => useThemeStore())

    act(() => {
      result.current.setTheme("light")
    })

    expect(result.current.theme).toBe("light")
  })

  it("should set theme to dark", () => {
    const { result } = renderHook(() => useThemeStore())

    act(() => {
      result.current.setTheme("dark")
    })

    expect(result.current.theme).toBe("dark")
  })

  it("should set theme back to system", () => {
    const { result } = renderHook(() => useThemeStore())

    act(() => {
      result.current.setTheme("dark")
    })
    expect(result.current.theme).toBe("dark")

    act(() => {
      result.current.setTheme("system")
    })
    expect(result.current.theme).toBe("system")
  })
})
