import { act, renderHook, waitFor } from "@testing-library/react"
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { STORAGE_KEYS } from "@/lib/constants"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"
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

type StorageListener = (
  changes: Record<string, { newValue?: unknown }>,
  areaName: string
) => void

describe("theme store", () => {
  let useThemeStore: typeof UseThemeStoreType
  let onStorageChanged: StorageListener

  beforeAll(async () => {
    const mod = await import("../theme")
    useThemeStore = mod.useThemeStore
    // Registered at import time, so capture it before beforeEach clears the
    // recorded calls.
    onStorageChanged = mockChrome.storage.onChanged.addListener.mock
      .calls[0][0] as StorageListener
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

  const themeEvent = (theme: string) => ({
    [STORAGE_KEYS.THEME.PREFERENCE]: {
      newValue: JSON.stringify({ state: { theme }, version: 0 })
    }
  })

  it("ignores a storage event carrying the theme it already has", async () => {
    // Persist writes on every state change, and Firefox reports a write as a
    // change whether or not the value moved — so applying a value this store
    // already holds writes it straight back and the event returns. One theme
    // change would feed itself until the UI crawls.
    const { result } = renderHook(() => useThemeStore())
    act(() => {
      result.current.setTheme("dark")
    })
    await waitFor(() => expect(plasmoGlobalStorage.set).toHaveBeenCalled())
    vi.mocked(plasmoGlobalStorage.set).mockClear()

    act(() => {
      onStorageChanged(themeEvent("dark"), "sync")
    })

    await Promise.resolve()
    expect(plasmoGlobalStorage.set).not.toHaveBeenCalled()
    expect(result.current.theme).toBe("dark")
  })

  it("applies a theme another context actually changed", async () => {
    const { result } = renderHook(() => useThemeStore())
    act(() => {
      result.current.setTheme("dark")
    })

    act(() => {
      onStorageChanged(themeEvent("light"), "sync")
    })

    expect(result.current.theme).toBe("light")
  })
})
