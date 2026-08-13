import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  getStoredValue: vi.fn(),
  setSelectionLanguage: vi.fn()
}))

vi.mock("@/i18n/selection-config", () => ({
  setSelectionLanguage: mocks.setSelectionLanguage
}))

vi.mock("@/lib/plasmo-global-storage", () => ({
  getPlasmoStoredValue: mocks.getStoredValue
}))

import {
  createLatestSelectionConfigRefresh,
  syncSelectionLanguage
} from "@/features/selection-actions/content-settings"

describe("createLatestSelectionConfigRefresh", () => {
  it("ignores an older read that resolves after a newer read", async () => {
    let resolveOld: (value: string) => void = () => undefined
    let resolveNew: (value: string) => void = () => undefined
    const oldRead = new Promise<string>((resolve) => {
      resolveOld = resolve
    })
    const newRead = new Promise<string>((resolve) => {
      resolveNew = resolve
    })
    const load = vi
      .fn<() => Promise<string>>()
      .mockReturnValueOnce(oldRead)
      .mockReturnValueOnce(newRead)
    const apply = vi.fn()
    const refresh = createLatestSelectionConfigRefresh(load, apply)

    const oldRefresh = refresh.run()
    const newRefresh = refresh.run()
    resolveNew("new")
    await newRefresh
    resolveOld("old")
    await oldRefresh

    expect(apply).toHaveBeenCalledTimes(1)
    expect(apply).toHaveBeenCalledWith("new")
  })

  it("does not apply a pending read after invalidation", async () => {
    let resolveRead: (value: string) => void = () => undefined
    const load = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveRead = resolve
        })
    )
    const apply = vi.fn()
    const refresh = createLatestSelectionConfigRefresh(load, apply)

    const pending = refresh.run()
    refresh.invalidate()
    resolveRead("stale")
    await pending

    expect(apply).not.toHaveBeenCalled()
  })
})

describe("syncSelectionLanguage", () => {
  beforeEach(() => {
    mocks.getStoredValue.mockResolvedValue("fr")
    mocks.setSelectionLanguage.mockRejectedValue(
      new Error("i18next initialization failed")
    )
  })

  it("does not block overlay mounting when locale initialization fails", async () => {
    await expect(syncSelectionLanguage()).resolves.toBeUndefined()
    expect(mocks.setSelectionLanguage).toHaveBeenCalledWith("fr")
  })
})
