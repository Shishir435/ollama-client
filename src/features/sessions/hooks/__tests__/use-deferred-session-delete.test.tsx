import { act, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  SESSION_DELETE_UNDO_MS,
  useDeferredSessionDelete
} from "../use-deferred-session-delete"

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

const toastMock = vi.hoisted(() => vi.fn((_options: unknown) => ({ id: 1 })))
vi.mock("@/hooks/use-toast", () => ({ toast: toastMock }))

describe("useDeferredSessionDelete", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    toastMock.mockClear()
  })
  afterEach(() => vi.useRealTimers())

  it("hides the chat at once and deletes it when the window closes", async () => {
    const deleteSession = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useDeferredSessionDelete(deleteSession))

    act(() => result.current.schedule("a"))
    expect(result.current.hiddenIds.has("a")).toBe(true)
    expect(deleteSession).not.toHaveBeenCalled()

    await act(async () => {
      vi.advanceTimersByTime(SESSION_DELETE_UNDO_MS)
    })
    expect(deleteSession).toHaveBeenCalledWith("a")
    expect(result.current.hiddenIds.has("a")).toBe(false)
  })

  it("restores the chat and never deletes it when Undo is pressed", () => {
    const deleteSession = vi.fn()
    const { result } = renderHook(() => useDeferredSessionDelete(deleteSession))

    act(() => result.current.schedule("a"))
    const options = toastMock.mock.calls[0]?.[0] as {
      action: { onClick: () => void }
    }
    act(() => options.action.onClick())
    expect(result.current.hiddenIds.has("a")).toBe(false)

    act(() => {
      vi.advanceTimersByTime(SESSION_DELETE_UNDO_MS * 2)
    })
    expect(deleteSession).not.toHaveBeenCalled()
  })

  it("commits a pending delete when the panel unmounts", () => {
    const deleteSession = vi.fn().mockResolvedValue(undefined)
    const { result, unmount } = renderHook(() =>
      useDeferredSessionDelete(deleteSession)
    )
    act(() => result.current.schedule("a"))
    unmount()
    expect(deleteSession).toHaveBeenCalledWith("a")
  })
})
