import { act, renderHook, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { STORAGE_KEYS } from "@/lib/constants"

const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  write: vi.fn(),
  watch: vi.fn(),
  unwatch: vi.fn(),
  storageForKey: vi.fn(),
  error: vi.fn()
}))

vi.mock("@/lib/storage/setting-access", () => ({
  readSetting: mocks.read,
  writeSetting: mocks.write
}))
vi.mock("@/lib/plasmo-global-storage", () => ({
  getPlasmoStorageForKey: mocks.storageForKey
}))
vi.mock("@/lib/logger", () => ({ logger: { error: mocks.error } }))

import { defineSetting } from "@/lib/storage/setting-descriptor"
import { useSetting } from "../use-setting"

const descriptor = defineSetting<string>(STORAGE_KEYS.LANGUAGE, {
  defaultValue: "en"
})

beforeEach(() => {
  vi.clearAllMocks()
  mocks.read.mockResolvedValue("fr")
  mocks.write.mockResolvedValue(undefined)
  mocks.storageForKey.mockReturnValue({
    watch: mocks.watch,
    unwatch: mocks.unwatch
  })
})

describe("useSetting", () => {
  it("serves the default until the stored value arrives", async () => {
    let release: (value: string) => void = () => {}
    mocks.read.mockReturnValue(
      new Promise<string>((resolve) => {
        release = resolve
      })
    )

    const { result } = renderHook(() => useSetting(descriptor))

    expect(result.current[0]).toBe("en")
    expect(result.current[2].isLoading).toBe(true)

    await act(async () => {
      release("fr")
    })
    expect(result.current[0]).toBe("fr")
    expect(result.current[2].isLoading).toBe(false)
  })

  it("resolves an updater against the latest value, not a stale render", async () => {
    mocks.read.mockResolvedValue("a")
    const { result } = renderHook(() => useSetting(descriptor))
    await waitFor(() => expect(result.current[0]).toBe("a"))

    act(() => {
      result.current[1]((current) => `${current}b`)
      result.current[1]((current) => `${current}c`)
    })

    // Both updaters ran in one batch; reading React state instead of the ref
    // would make the second one see "a" and drop the first.
    expect(result.current[0]).toBe("abc")
    expect(mocks.write).toHaveBeenLastCalledWith(descriptor, "abc")
  })

  it("rolls back to the stored value when the write fails", async () => {
    mocks.read.mockResolvedValue("en")
    const { result } = renderHook(() => useSetting(descriptor))
    await waitFor(() => expect(result.current[2].isLoading).toBe(false))

    mocks.write.mockRejectedValueOnce(new Error("quota exceeded"))
    mocks.read.mockResolvedValue("en")

    await act(async () => {
      result.current[1]("de")
    })

    // The optimistic value must not survive a rejected write — otherwise the
    // UI claims a setting the storage layer refused, which is exactly what the
    // new quota guard now produces.
    await waitFor(() => expect(result.current[0]).toBe("en"))
    expect(mocks.error).toHaveBeenCalledWith(
      "Setting write failed",
      "useSetting",
      expect.objectContaining({ key: STORAGE_KEYS.LANGUAGE })
    )
  })

  it("falls back to the default when a rollback read finds nothing", async () => {
    const { result } = renderHook(() => useSetting(descriptor))
    await waitFor(() => expect(result.current[2].isLoading).toBe(false))

    mocks.write.mockRejectedValueOnce(new Error("quota exceeded"))
    mocks.read.mockResolvedValue(undefined)

    await act(async () => {
      result.current[1]("de")
    })

    await waitFor(() => expect(result.current[0]).toBe("en"))
  })

  it("re-reads when another context changes the key, and unwatches on unmount", async () => {
    const { result, unmount } = renderHook(() => useSetting(descriptor))
    await waitFor(() => expect(result.current[0]).toBe("fr"))

    const registered = mocks.watch.mock.calls[0][0] as Record<
      string,
      () => void
    >
    expect(Object.keys(registered)).toEqual([STORAGE_KEYS.LANGUAGE])

    mocks.read.mockResolvedValue("de")
    await act(async () => {
      registered[STORAGE_KEYS.LANGUAGE]()
    })
    expect(result.current[0]).toBe("de")

    unmount()
    expect(mocks.unwatch).toHaveBeenCalledWith(registered)
  })

  it("ignores a read that resolves after unmount", async () => {
    let release: (value: string) => void = () => {}
    mocks.read.mockReturnValue(
      new Promise<string>((resolve) => {
        release = resolve
      })
    )

    const { unmount } = renderHook(() => useSetting(descriptor))
    unmount()

    // A setState here would warn and, on a remount, race the fresh read.
    await act(async () => {
      release("fr")
    })
  })
})
