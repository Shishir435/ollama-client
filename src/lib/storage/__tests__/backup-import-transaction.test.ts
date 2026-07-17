import { beforeEach, describe, expect, it, vi } from "vitest"
import { STORAGE_KEYS } from "@/lib/constants"
import {
  importPortableStorageTransaction,
  recoverBackupImport
} from "@/lib/storage/backup-import-transaction"

const storageState = vi.hoisted(() => ({
  local: new Map<string, unknown>(),
  providerSync: new Map<string, unknown>()
}))

vi.mock("@/lib/plasmo-global-storage", () => ({
  plasmoDeviceStorage: {
    get: vi.fn(async (key: string) => storageState.local.get(key)),
    set: vi.fn(async (key: string, value: unknown) => {
      storageState.local.set(key, structuredClone(value))
    }),
    remove: vi.fn(async (key: string) => {
      storageState.local.delete(key)
    })
  },
  plasmoGlobalStorage: {
    get: vi.fn(async (key: string) => storageState.providerSync.get(key)),
    set: vi.fn(async (key: string, value: unknown) => {
      storageState.providerSync.set(key, structuredClone(value))
    }),
    remove: vi.fn(async (key: string) => {
      storageState.providerSync.delete(key)
    })
  }
}))

describe("portable storage import transaction", () => {
  const syncState = new Map<string, unknown>()

  const installWorkingSyncStorage = () => {
    ;(chrome.storage.sync.get as any).mockImplementation(
      async (keys: string[]) =>
        Object.fromEntries(
          keys
            .filter((key) => syncState.has(key))
            .map((key) => [key, structuredClone(syncState.get(key))])
        )
    )
    ;(chrome.storage.sync.set as any).mockImplementation(
      async (values: Record<string, unknown>) => {
        for (const [key, value] of Object.entries(values)) {
          syncState.set(key, structuredClone(value))
        }
      }
    )
    ;(chrome.storage.sync.remove as any).mockImplementation(
      async (keys: string[]) => {
        for (const key of keys) syncState.delete(key)
      }
    )
  }

  beforeEach(() => {
    vi.clearAllMocks()
    syncState.clear()
    storageState.local.clear()
    storageState.providerSync.clear()
    installWorkingSyncStorage()
  })

  it("keeps existing settings when replacement values exceed quota", async () => {
    syncState.set(STORAGE_KEYS.THEME.PREFERENCE, "light")
    vi.mocked(chrome.storage.sync.set).mockRejectedValueOnce(
      new Error("QUOTA_BYTES_PER_ITEM quota exceeded")
    )

    await expect(
      importPortableStorageTransaction({
        [STORAGE_KEYS.THEME.PREFERENCE]: "dark"
      })
    ).rejects.toThrow("QUOTA_BYTES_PER_ITEM quota exceeded")

    expect(Object.fromEntries(syncState)).toEqual({
      [STORAGE_KEYS.THEME.PREFERENCE]: "light"
    })
    expect(storageState.local.has(STORAGE_KEYS.BACKUP.IMPORT_JOURNAL)).toBe(
      false
    )
  })

  it("restores the previous settings when replacement removal fails", async () => {
    syncState.set(STORAGE_KEYS.THEME.PREFERENCE, "light")
    syncState.set(STORAGE_KEYS.LANGUAGE, "en")
    vi.mocked(chrome.storage.sync.remove).mockRejectedValueOnce(
      new Error("sync remove failed")
    )

    await expect(
      importPortableStorageTransaction({
        [STORAGE_KEYS.THEME.PREFERENCE]: "dark"
      })
    ).rejects.toThrow("sync remove failed")

    expect(Object.fromEntries(syncState)).toEqual({
      [STORAGE_KEYS.THEME.PREFERENCE]: "light",
      [STORAGE_KEYS.LANGUAGE]: "en"
    })
    expect(storageState.local.has(STORAGE_KEYS.BACKUP.IMPORT_JOURNAL)).toBe(
      false
    )
  })

  it("keeps a durable journal when rollback fails and recovers on startup", async () => {
    syncState.set(STORAGE_KEYS.THEME.PREFERENCE, "light")
    let setCalls = 0
    vi.mocked(chrome.storage.sync.set).mockImplementation(async (values) => {
      setCalls += 1
      if (setCalls === 2) throw new Error("rollback set failed")
      for (const [key, value] of Object.entries(values)) {
        syncState.set(key, structuredClone(value))
      }
    })
    vi.mocked(chrome.storage.sync.remove).mockRejectedValueOnce(
      new Error("sync remove failed")
    )

    await expect(
      importPortableStorageTransaction({
        [STORAGE_KEYS.THEME.PREFERENCE]: "dark"
      })
    ).rejects.toThrow("Portable settings import and rollback both failed")
    expect(storageState.local.has(STORAGE_KEYS.BACKUP.IMPORT_JOURNAL)).toBe(
      true
    )

    await recoverBackupImport()

    expect(Object.fromEntries(syncState)).toEqual({
      [STORAGE_KEYS.THEME.PREFERENCE]: "light"
    })
    expect(storageState.local.has(STORAGE_KEYS.BACKUP.IMPORT_JOURNAL)).toBe(
      false
    )
  })
})
