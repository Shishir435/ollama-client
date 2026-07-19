import { renderHook } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { useResetAppStorage } from "@/hooks/use-reset-app-storage"
import { browser } from "@/lib/browser-api"
import { STORAGE_KEYS } from "@/lib/constants"
import { feedbackService } from "@/lib/embeddings/feedback-service"
import { getAllResetKeys } from "@/lib/get-all-reset-keys"
import { removePlasmoStoredValue } from "@/lib/plasmo-global-storage"
import {
  resetProviderStorageUnlocked,
  withProviderPersistenceLock
} from "@/lib/providers/provider-secret-store"
import { ProviderStorageKey } from "@/lib/providers/types"
import { resetSQLiteDatabase } from "@/lib/sqlite/db"

vi.mock("@/lib/browser-api", () => ({
  browser: {
    runtime: {
      reload: vi.fn(),
      openOptionsPage: vi.fn().mockResolvedValue(undefined)
    },
    tabs: { create: vi.fn().mockResolvedValue(undefined) }
  },
  isChromiumBased: () => true
}))

vi.mock("@/lib/embeddings/feedback-service", () => ({
  feedbackService: {
    clearAllFeedback: vi.fn().mockResolvedValue(undefined)
  }
}))

vi.mock("@/lib/sqlite/db", () => ({
  resetSQLiteDatabase: vi.fn().mockResolvedValue(undefined)
}))

vi.mock("@/lib/providers/provider-secret-store", () => ({
  resetProviderStorageUnlocked: vi.fn().mockResolvedValue(undefined),
  withProviderPersistenceLock: vi.fn(
    async (operation: () => Promise<unknown>) => operation()
  )
}))

vi.mock("@/lib/plasmo-global-storage", () => ({
  plasmoDeviceStorage: {
    clear: vi.fn().mockResolvedValue(undefined)
  },
  plasmoGlobalStorage: {
    clear: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined)
  },
  removePlasmoStoredValue: vi.fn().mockResolvedValue(undefined)
}))

describe("useResetAppStorage", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("schedules a background reset and reloads for key 'all'", async () => {
    const { result } = renderHook(() => useResetAppStorage())
    const reset = result.current

    const message = await reset("all")

    // Destructive resets never run in the page: pages hold IndexedDB
    // handles that block deleteDatabase. The work happens in the fresh
    // background worker after runtime.reload().
    expect(message).toBe("Resetting...")
    expect(resetSQLiteDatabase).not.toHaveBeenCalled()
    expect(chrome.storage.local.set).toHaveBeenCalledWith({
      [STORAGE_KEYS.APP_LIFECYCLE.PENDING_RESET]: expect.objectContaining({
        key: "all"
      })
    })
    expect(browser.runtime.reload).toHaveBeenCalled()
  })

  it("schedules a background reset for key 'CHAT_SESSIONS'", async () => {
    const { result } = renderHook(() => useResetAppStorage())
    const reset = result.current

    await reset("CHAT_SESSIONS")

    expect(resetSQLiteDatabase).not.toHaveBeenCalled()
    expect(chrome.storage.local.set).toHaveBeenCalledWith({
      [STORAGE_KEYS.APP_LIFECYCLE.PENDING_RESET]: expect.objectContaining({
        key: "CHAT_SESSIONS"
      })
    })
    expect(browser.runtime.reload).toHaveBeenCalled()
  })

  it("should reset only feedback when key is 'FEEDBACK'", async () => {
    const { result } = renderHook(() => useResetAppStorage())
    const reset = result.current

    await reset("FEEDBACK")

    expect(feedbackService.clearAllFeedback).toHaveBeenCalled()
    expect(resetSQLiteDatabase).not.toHaveBeenCalled()
    expect(removePlasmoStoredValue).not.toHaveBeenCalled()
  })

  it("should reset specific module keys when key is a module name", async () => {
    const { result } = renderHook(() => useResetAppStorage())
    const reset = result.current

    // THEME module usually has keys
    await reset("THEME")

    expect(removePlasmoStoredValue).toHaveBeenCalled()
    expect(resetSQLiteDatabase).not.toHaveBeenCalled()
    expect(feedbackService.clearAllFeedback).not.toHaveBeenCalled()
    expect(withProviderPersistenceLock).not.toHaveBeenCalled()
  })

  it("holds the provider persistence lock while removing provider keys", async () => {
    let runLockedReset: (() => Promise<unknown>) | undefined
    vi.mocked(withProviderPersistenceLock).mockImplementationOnce(
      async (operation) => {
        runLockedReset = operation
        return new Promise(() => undefined)
      }
    )

    const { result } = renderHook(() => useResetAppStorage())
    void result.current("PROVIDER")
    await Promise.resolve()

    expect(withProviderPersistenceLock).toHaveBeenCalledOnce()
    expect(removePlasmoStoredValue).not.toHaveBeenCalled()

    await runLockedReset?.()
    expect(resetProviderStorageUnlocked).toHaveBeenCalledWith(
      expect.arrayContaining([
        ProviderStorageKey.CONFIG,
        STORAGE_KEYS.PROVIDER.SECRETS,
        STORAGE_KEYS.PROVIDER.PERSISTENCE_JOURNAL,
        STORAGE_KEYS.PROVIDER.RESET_JOURNAL
      ])
    )
  })

  it("reports durable provider reset failures", async () => {
    vi.mocked(resetProviderStorageUnlocked).mockRejectedValueOnce(
      new Error("reset interrupted")
    )

    const { result } = renderHook(() => useResetAppStorage())
    const message = await result.current("PROVIDER")

    expect(message).toBe("Failed to reset app data. Check console for details.")
    expect(removePlasmoStoredValue).not.toHaveBeenCalled()
  })

  it("includes string storage keys and provider secrets in module reset maps", () => {
    const keys = getAllResetKeys()

    expect(keys.LANGUAGE).toEqual(["app-language"])
    expect(keys.PROVIDER).toContain(ProviderStorageKey.CONFIG)
    expect(keys.PROVIDER).toContain(STORAGE_KEYS.PROVIDER.SECRETS)
    expect(keys.PROVIDER).toContain(STORAGE_KEYS.PROVIDER.PERSISTENCE_JOURNAL)
    expect(keys.PROVIDER).toContain(STORAGE_KEYS.PROVIDER.RESET_JOURNAL)
    expect(keys.PROVIDER).toContain(ProviderStorageKey.MODEL_MAPPINGS)
  })
})
