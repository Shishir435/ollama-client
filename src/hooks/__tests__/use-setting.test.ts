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

  /**
   * A dragged slider writes several values in a row; each write's change
   * event re-read storage and could land an earlier value on top of the one
   * already shown, jumping the thumb backwards.
   */
  it("drops its own change echo while a write is still in flight", async () => {
    mocks.read.mockResolvedValue("a")
    const { result } = renderHook(() => useSetting(descriptor))
    await waitFor(() => expect(result.current[0]).toBe("a"))
    const registered = mocks.watch.mock.calls[0][0] as Record<
      string,
      () => void
    >

    let settle: () => void = () => {}
    mocks.write.mockReturnValue(
      new Promise<void>((resolve) => {
        settle = resolve
      })
    )
    act(() => {
      result.current[1]("b")
      result.current[1]("c")
    })

    mocks.read.mockResolvedValue("b")
    await act(async () => {
      registered[STORAGE_KEYS.LANGUAGE]()
    })
    expect(result.current[0]).toBe("c")

    await act(async () => {
      settle()
    })
    mocks.read.mockResolvedValue("z")
    await act(async () => {
      registered[STORAGE_KEYS.LANGUAGE]()
    })
    expect(result.current[0]).toBe("z")
  })

  it("drops a read that began before a newer write, even once writes settle", async () => {
    mocks.read.mockResolvedValue("a")
    const { result } = renderHook(() => useSetting(descriptor))
    await waitFor(() => expect(result.current[0]).toBe("a"))
    const registered = mocks.watch.mock.calls[0][0] as Record<
      string,
      () => void
    >

    /** The echo of "b" starts a read that is held open. */
    let releaseOld: (value: string) => void = () => {}
    mocks.read.mockReturnValueOnce(
      new Promise<string>((resolve) => {
        releaseOld = resolve
      })
    )
    registered[STORAGE_KEYS.LANGUAGE]()

    /** "c" is written and settles; its own refresh reads "c". */
    mocks.read.mockResolvedValue("c")
    await act(async () => {
      result.current[1]("c")
    })
    expect(result.current[0]).toBe("c")

    await act(async () => {
      releaseOld("b")
    })
    expect(result.current[0]).toBe("c")
  })

  it("picks up another page's change once its own write settles", async () => {
    mocks.read.mockResolvedValue("a")
    const { result } = renderHook(() => useSetting(descriptor))
    await waitFor(() => expect(result.current[0]).toBe("a"))
    const registered = mocks.watch.mock.calls[0][0] as Record<
      string,
      () => void
    >

    let settle: () => void = () => {}
    mocks.write.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        settle = resolve
      })
    )
    act(() => {
      result.current[1]("b")
    })

    /** Another page writes "z" while ours is in flight; that read is dropped. */
    mocks.read.mockResolvedValue("z")
    await act(async () => {
      registered[STORAGE_KEYS.LANGUAGE]()
    })
    expect(result.current[0]).toBe("b")

    await act(async () => {
      settle()
    })
    await waitFor(() => expect(result.current[0]).toBe("z"))
  })

  it("does not let an older failed write roll back a newer value", async () => {
    mocks.read.mockResolvedValue("a")
    const { result } = renderHook(() => useSetting(descriptor))
    await waitFor(() => expect(result.current[0]).toBe("a"))

    let failOld: (error: Error) => void = () => {}
    let settleNew: () => void = () => {}
    mocks.write
      .mockReturnValueOnce(
        new Promise<void>((_, reject) => {
          failOld = reject
        })
      )
      .mockReturnValueOnce(
        new Promise<void>((resolve) => {
          settleNew = resolve
        })
      )
    act(() => {
      result.current[1]("b")
      result.current[1]("c")
    })

    await act(async () => {
      failOld(new Error("quota exceeded"))
    })
    expect(result.current[0]).toBe("c")

    mocks.read.mockResolvedValue("c")
    await act(async () => {
      settleNew()
    })
    expect(result.current[0]).toBe("c")
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
