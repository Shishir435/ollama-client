import { renderHook } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { useResetAppStorage } from "@/hooks/use-reset-app-storage"
import { feedbackService } from "@/lib/embeddings/feedback-service"
import { getAllResetKeys } from "@/lib/get-all-reset-keys"
import {
  plasmoDeviceStorage,
  plasmoGlobalStorage,
  removePlasmoStoredValue
} from "@/lib/plasmo-global-storage"
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
  })

  it("includes string storage keys and provider secrets in module reset maps", () => {
    const keys = getAllResetKeys()

    expect(keys.LANGUAGE).toEqual(["app-language"])
    expect(keys.FEATURE_FLAGS).toEqual(["feature-flags"])
    expect(keys.PROVIDER).toContain(ProviderStorageKey.CONFIG)
    expect(keys.PROVIDER).toContain(ProviderStorageKey.MODEL_MAPPINGS)
  })
})
