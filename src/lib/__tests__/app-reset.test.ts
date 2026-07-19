import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  performAppReset,
  resumePendingAppLifecycle,
  scheduleDestructiveReset
} from "@/lib/app-reset"
import { browser } from "@/lib/browser-api"
import { STORAGE_KEYS } from "@/lib/constants"
import { feedbackService } from "@/lib/embeddings/feedback-service"
import {
  plasmoDeviceStorage,
  plasmoGlobalStorage
} from "@/lib/plasmo-global-storage"
import {
  resetProviderStorageUnlocked,
  withProviderPersistenceLock
} from "@/lib/providers/provider-secret-store"
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

describe("app-reset", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(chrome.storage.local.get as any).mockResolvedValue({})
  })

  it("performAppReset('all') wipes database, feedback, and storages", async () => {
    await performAppReset("all")

    expect(resetSQLiteDatabase).toHaveBeenCalled()
    expect(feedbackService.clearAllFeedback).toHaveBeenCalled()
    expect(plasmoGlobalStorage.clear).toHaveBeenCalled()
    expect(plasmoDeviceStorage.clear).toHaveBeenCalled()
    expect(withProviderPersistenceLock).toHaveBeenCalledOnce()
    expect(resetProviderStorageUnlocked).toHaveBeenCalled()
  })

  it("performAppReset('CHAT_SESSIONS') only drops the chat database", async () => {
    await performAppReset("CHAT_SESSIONS")

    expect(resetSQLiteDatabase).toHaveBeenCalled()
    expect(feedbackService.clearAllFeedback).not.toHaveBeenCalled()
    expect(plasmoGlobalStorage.clear).not.toHaveBeenCalled()
  })

  it("scheduleDestructiveReset persists the flag then reloads", async () => {
    await scheduleDestructiveReset("all", "chrome-extension://x/options.html")

    expect(chrome.storage.local.set).toHaveBeenCalledWith({
      [STORAGE_KEYS.APP_LIFECYCLE.PENDING_RESET]: {
        key: "all",
        reopenUrl: "chrome-extension://x/options.html"
      }
    })
    expect(browser.runtime.reload).toHaveBeenCalled()
    expect(resetSQLiteDatabase).not.toHaveBeenCalled()
  })

  it("resumePendingAppLifecycle executes a pending reset and reopens options", async () => {
    ;(chrome.storage.local.get as any).mockResolvedValue({
      [STORAGE_KEYS.APP_LIFECYCLE.PENDING_RESET]: {
        key: "CHAT_SESSIONS",
        reopenUrl: "chrome-extension://x/options.html?tab=privacy"
      }
    })

    await resumePendingAppLifecycle()

    // Flag cleared before executing so a crash cannot loop the worker.
    expect(chrome.storage.local.remove).toHaveBeenCalledWith([
      STORAGE_KEYS.APP_LIFECYCLE.PENDING_RESET,
      STORAGE_KEYS.APP_LIFECYCLE.REOPEN_OPTIONS
    ])
    expect(resetSQLiteDatabase).toHaveBeenCalled()
    expect(browser.tabs.create).toHaveBeenCalledWith({
      url: "chrome-extension://x/options.html?tab=privacy"
    })
  })

  it("resumePendingAppLifecycle handles a reopen-only flag", async () => {
    ;(chrome.storage.local.get as any).mockResolvedValue({
      [STORAGE_KEYS.APP_LIFECYCLE.REOPEN_OPTIONS]: {
        url: "chrome-extension://x/options.html"
      }
    })

    await resumePendingAppLifecycle()

    expect(resetSQLiteDatabase).not.toHaveBeenCalled()
    expect(browser.tabs.create).toHaveBeenCalledWith({
      url: "chrome-extension://x/options.html"
    })
  })

  it("resumePendingAppLifecycle is a no-op without flags", async () => {
    await resumePendingAppLifecycle()

    expect(chrome.storage.local.remove).not.toHaveBeenCalled()
    expect(resetSQLiteDatabase).not.toHaveBeenCalled()
    expect(browser.tabs.create).not.toHaveBeenCalled()
  })

  it("resumePendingAppLifecycle still reopens options when the reset fails", async () => {
    ;(chrome.storage.local.get as any).mockResolvedValue({
      [STORAGE_KEYS.APP_LIFECYCLE.PENDING_RESET]: {
        key: "all",
        reopenUrl: "chrome-extension://x/options.html"
      }
    })
    vi.mocked(resetSQLiteDatabase).mockRejectedValueOnce(
      new Error("delete blocked")
    )

    await resumePendingAppLifecycle()

    expect(browser.tabs.create).toHaveBeenCalledWith({
      url: "chrome-extension://x/options.html"
    })
  })
})
