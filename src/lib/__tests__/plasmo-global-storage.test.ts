import { describe, expect, it, vi } from "vitest"
import { STORAGE_KEYS } from "@/lib/constants"

vi.unmock("@/lib/plasmo-global-storage")

describe("plasmoGlobalStorage", () => {
  it("exposes the legacy sync storage handle", async () => {
    const { plasmoGlobalStorage } = await import("../plasmo-global-storage")

    expect(plasmoGlobalStorage).toBeDefined()
    expect(typeof plasmoGlobalStorage.get).toBe("function")
    expect(typeof plasmoGlobalStorage.set).toBe("function")
  })

  it("routes device-local keys to local storage", async () => {
    const {
      getPlasmoStorageForKey,
      isDeviceLocalStorageKey,
      plasmoDeviceStorage
    } = await import("../plasmo-global-storage")

    expect(
      isDeviceLocalStorageKey(STORAGE_KEYS.BROWSER.PENDING_SELECTION_TEXT)
    ).toBe(true)
    expect(
      getPlasmoStorageForKey(STORAGE_KEYS.BROWSER.PENDING_SELECTION_TEXT)
    ).toBe(plasmoDeviceStorage)
  })

  it("routes sync-safe keys to sync storage", async () => {
    const {
      getPlasmoStorageForKey,
      isDeviceLocalStorageKey,
      plasmoSyncStorage
    } = await import("../plasmo-global-storage")

    expect(isDeviceLocalStorageKey(STORAGE_KEYS.LANGUAGE)).toBe(false)
    expect(getPlasmoStorageForKey(STORAGE_KEYS.LANGUAGE)).toBe(
      plasmoSyncStorage
    )
  })
})
