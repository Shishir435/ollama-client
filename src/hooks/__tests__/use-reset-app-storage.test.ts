import { renderHook } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { useResetAppStorage } from "@/hooks/use-reset-app-storage"
import { STORAGE_KEYS } from "@/lib/constants"
import { feedbackService } from "@/lib/embeddings/feedback-service"
import { getAllResetKeys } from "@/lib/get-all-reset-keys"
import {
  plasmoDeviceStorage,
  plasmoGlobalStorage,
  removePlasmoStoredValue
} from "@/lib/plasmo-global-storage"
import { withProviderPersistenceLock } from "@/lib/providers/provider-secret-store"
import { ProviderStorageKey } from "@/lib/providers/types"
import { resetSQLiteDatabase } from "@/lib/sqlite/db"

vi.mock("@/lib/embeddings/feedback-service", () => ({
  feedbackService: {
    clearAllFeedback: vi.fn().mockResolvedValue(undefined)
  }
}))

vi.mock("@/lib/sqlite/db", () => ({
  resetSQLiteDatabase: vi.fn().mockResolvedValue(undefined)
}))

vi.mock("@/lib/providers/provider-secret-store", () => ({
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

  it("should reset all data when key is 'all'", async () => {
    const { result } = renderHook(() => useResetAppStorage())
    const reset = result.current

    await reset("all")

    expect(resetSQLiteDatabase).toHaveBeenCalled()
    expect(feedbackService.clearAllFeedback).toHaveBeenCalled()
    expect(plasmoGlobalStorage.clear).toHaveBeenCalled()
    expect(plasmoDeviceStorage.clear).toHaveBeenCalled()
    expect(withProviderPersistenceLock).toHaveBeenCalledOnce()
  })

  it("should reset only chat sessions when key is 'CHAT_SESSIONS'", async () => {
    const { result } = renderHook(() => useResetAppStorage())
    const reset = result.current

    await reset("CHAT_SESSIONS")

    expect(resetSQLiteDatabase).toHaveBeenCalled()
    expect(feedbackService.clearAllFeedback).not.toHaveBeenCalled()
    expect(removePlasmoStoredValue).not.toHaveBeenCalled()
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

    const lockedReset = runLockedReset?.()
    await Promise.resolve()

    expect(removePlasmoStoredValue).toHaveBeenCalledWith(
      ProviderStorageKey.CONFIG
    )
    await lockedReset
    expect(removePlasmoStoredValue).toHaveBeenCalledWith(
      STORAGE_KEYS.PROVIDER.SECRETS
    )
    expect(removePlasmoStoredValue).toHaveBeenCalledWith(
      STORAGE_KEYS.PROVIDER.PERSISTENCE_JOURNAL
    )
  })

  it("keeps credentials when provider config removal fails", async () => {
    vi.mocked(removePlasmoStoredValue).mockImplementation(async (key) => {
      if (key === ProviderStorageKey.CONFIG) {
        throw new Error("sync removal failed")
      }
    })

    const { result } = renderHook(() => useResetAppStorage())
    const message = await result.current("PROVIDER")

    expect(message).toBe("Failed to reset app data. Check console for details.")
    expect(removePlasmoStoredValue).toHaveBeenCalledTimes(1)
    expect(removePlasmoStoredValue).not.toHaveBeenCalledWith(
      STORAGE_KEYS.PROVIDER.SECRETS
    )
    expect(removePlasmoStoredValue).not.toHaveBeenCalledWith(
      STORAGE_KEYS.PROVIDER.PERSISTENCE_JOURNAL
    )
  })

  it("includes string storage keys and provider secrets in module reset maps", () => {
    const keys = getAllResetKeys()

    expect(keys.LANGUAGE).toEqual(["app-language"])
    expect(keys.PROVIDER).toContain(ProviderStorageKey.CONFIG)
    expect(keys.PROVIDER).toContain(STORAGE_KEYS.PROVIDER.SECRETS)
    expect(keys.PROVIDER).toContain(STORAGE_KEYS.PROVIDER.PERSISTENCE_JOURNAL)
    expect(keys.PROVIDER).toContain(ProviderStorageKey.MODEL_MAPPINGS)
  })
})
