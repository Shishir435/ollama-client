import { act, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { THEME_MIRROR_KEY, useThemeWatcher } from "@/hooks/use-theme-watcher"
import { useThemeStore } from "@/stores/theme"

type Listener = (event: MediaQueryListEvent) => void

const installMatchMedia = (matches: boolean) => {
  const listeners = new Set<Listener>()
  const query = {
    matches,
    addEventListener: vi.fn((_: string, l: Listener) => listeners.add(l)),
    removeEventListener: vi.fn((_: string, l: Listener) => listeners.delete(l))
  }
  window.matchMedia = vi.fn(() => query) as unknown as typeof window.matchMedia
  return {
    query,
    listeners,
    emit: (next: boolean) =>
      listeners.forEach((l) => l({ matches: next } as MediaQueryListEvent))
  }
}

describe("useThemeWatcher", () => {
  const root = document.documentElement

  beforeEach(() => {
    root.classList.remove("light", "dark")
    window.localStorage.clear()
  })
  afterEach(() => {
    useThemeStore.setState({ theme: "system" })
  })

  it("follows the OS while the theme is system", () => {
    const media = installMatchMedia(false)
    useThemeStore.setState({ theme: "system" })
    const { unmount } = renderHook(() => useThemeWatcher())
    expect(root.classList.contains("light")).toBe(true)

    act(() => media.emit(true))
    expect(root.classList.contains("dark")).toBe(true)
    expect(root.classList.contains("light")).toBe(false)

    unmount()
    expect(media.listeners.size).toBe(0)
  })

  it("ignores OS changes under an explicit theme and mirrors the choice", () => {
    const media = installMatchMedia(false)
    useThemeStore.setState({ theme: "dark" })
    renderHook(() => useThemeWatcher())
    expect(root.classList.contains("dark")).toBe(true)
    expect(media.query.addEventListener).not.toHaveBeenCalled()
    expect(window.localStorage.getItem(THEME_MIRROR_KEY)).toBe("dark")
  })
})
