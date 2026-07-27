import { describe, expect, it, vi } from "vitest"
import browser from "@/lib/browser-api"
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

  /*
   * The guard used to sit in `setPlasmoStoredValue`, so the 34 direct writes
   * through the raw alias and every `useStorage({ instance })` setter wrote
   * past it — including provider configs and model/tool overrides, the records
   * most likely to overflow. These pin the guard to the instance instead.
   */
  describe("sync quota enforcement", () => {
    const oversized = "x".repeat(9_000)

    it("rejects an over-quota write made through the deprecated alias", async () => {
      const { plasmoGlobalStorage } = await import("../plasmo-global-storage")

      await expect(
        plasmoGlobalStorage.set(STORAGE_KEYS.LANGUAGE, oversized)
      ).rejects.toMatchObject({
        name: "SyncStorageQuotaError",
        kind: "item"
      })
    })

    it("rejects an over-quota write made through setMany", async () => {
      const { plasmoSyncStorage } = await import("../plasmo-global-storage")

      await expect(
        plasmoSyncStorage.setMany({ [STORAGE_KEYS.LANGUAGE]: oversized })
      ).rejects.toMatchObject({ key: STORAGE_KEYS.LANGUAGE, kind: "item" })
    })

    it("leaves local storage unguarded — it has no per-item ceiling", async () => {
      const { plasmoDeviceStorage } = await import("../plasmo-global-storage")
      const set = vi
        .spyOn(plasmoDeviceStorage, "set")
        .mockResolvedValueOnce(null)

      await expect(
        plasmoDeviceStorage.set(STORAGE_KEYS.PROVIDER.SECRETS, oversized)
      ).resolves.not.toThrow()
      expect(set).toHaveBeenCalled()
    })

    it("checks a sync write once, not once per wrapper layer", async () => {
      // setPlasmoStoredValue used to assert the quota itself and then call an
      // instance that now asserts it again — two getBytesInUse round trips per
      // write, on the hot path for every settings change.
      const sync = browser.storage.sync as unknown as {
        getBytesInUse?: (keys: string | string[] | null) => Promise<number>
      }
      const getBytesInUse = vi.fn(async () => 1)
      sync.getBytesInUse = getBytesInUse

      const { setPlasmoStoredValue } = await import("../plasmo-global-storage")
      await setPlasmoStoredValue(STORAGE_KEYS.LANGUAGE, "en")

      // One assertion => two reads (total + this key).
      expect(getBytesInUse).toHaveBeenCalledTimes(2)
      delete sync.getBytesInUse
    })
  })

  /*
   * The alias does not route by registry scope, so a device-local key written
   * through it lands in sync — for credentials, the difference between one
   * profile and every profile. Nothing writes such a key today; these keep it
   * that way without first migrating ~95 call sites to descriptors.
   */
  describe("device-local scope enforcement", () => {
    it("refuses a device-local key written through the sync handle", async () => {
      const { plasmoGlobalStorage } = await import("../plasmo-global-storage")

      await expect(
        plasmoGlobalStorage.set(STORAGE_KEYS.PROVIDER.SECRETS, {
          openai: "sk-secret"
        })
      ).rejects.toMatchObject({
        name: "DeviceLocalKeyInSyncError",
        key: STORAGE_KEYS.PROVIDER.SECRETS
      })
    })

    it("refuses one inside a setMany batch rather than writing the rest", async () => {
      const { plasmoSyncStorage } = await import("../plasmo-global-storage")

      await expect(
        plasmoSyncStorage.setMany({
          [STORAGE_KEYS.LANGUAGE]: "en",
          [STORAGE_KEYS.PROVIDER.SECRETS]: { openai: "sk-secret" }
        })
      ).rejects.toMatchObject({ name: "DeviceLocalKeyInSyncError" })
    })

    it("still allows removing a device-local key from sync", async () => {
      // getPlasmoStoredValue reads a legacy sync value and deletes it as part
      // of moving the key to local; blocking that would strand the copy it is
      // trying to clean up.
      const { plasmoSyncStorage } = await import("../plasmo-global-storage")
      const remove = vi
        .spyOn(plasmoSyncStorage, "remove")
        .mockResolvedValueOnce(undefined)

      await expect(
        plasmoSyncStorage.remove(STORAGE_KEYS.PROVIDER.SECRETS)
      ).resolves.toBeUndefined()
      expect(remove).toHaveBeenCalled()
    })

    it("leaves sync-safe keys alone", async () => {
      const { plasmoSyncStorage } = await import("../plasmo-global-storage")
      vi.spyOn(plasmoSyncStorage, "set").mockResolvedValueOnce(null)

      await expect(
        plasmoSyncStorage.set(STORAGE_KEYS.LANGUAGE, "en")
      ).resolves.not.toThrow()
    })
  })

  it("moves legacy sync values into local storage on first device-local read", async () => {
    const { getPlasmoStoredValue, plasmoDeviceStorage, plasmoSyncStorage } =
      await import("../plasmo-global-storage")
    const key = STORAGE_KEYS.WEB_SEARCH.CONFIG
    const config = { backend: "searxng", baseUrl: "http://localhost:8080" }

    vi.spyOn(plasmoDeviceStorage, "get").mockResolvedValueOnce(undefined)
    vi.spyOn(plasmoDeviceStorage, "set").mockResolvedValueOnce(null)
    vi.spyOn(plasmoSyncStorage, "get").mockResolvedValueOnce(config)
    vi.spyOn(plasmoSyncStorage, "remove").mockResolvedValueOnce(undefined)

    await expect(getPlasmoStoredValue(key)).resolves.toEqual(config)
    expect(plasmoDeviceStorage.set).toHaveBeenCalledWith(key, config)
    expect(plasmoSyncStorage.remove).toHaveBeenCalledWith(key)
  })
})
