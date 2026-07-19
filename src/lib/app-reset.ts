import { browser } from "@/lib/browser-api"
import { STORAGE_KEYS } from "@/lib/constants"
import { feedbackService } from "@/lib/embeddings/feedback-service"
import { getAllResetKeys } from "@/lib/get-all-reset-keys"
import { logger } from "@/lib/logger"
import {
  plasmoDeviceStorage,
  plasmoGlobalStorage,
  removePlasmoStoredValue
} from "@/lib/plasmo-global-storage"
import {
  resetProviderStorageUnlocked,
  withProviderPersistenceLock
} from "@/lib/providers/provider-secret-store"
import { resetSQLiteDatabase } from "@/lib/sqlite/db"

export type ResetKey = keyof ReturnType<typeof getAllResetKeys> | "all"

// Destructive resets (chat database, full wipe) must not run while extension
// pages hold IndexedDB handles: deleteDatabase blocks on open connections and
// re-initialization then fails mid-delete. The flow is therefore: persist a
// pending-reset flag, runtime.reload() the whole extension (closing every
// page), and execute the reset from the fresh background worker before
// anything else touches the database. The options page is reopened afterward
// so the reload does not look like a crash.

interface PendingReset {
  key: ResetKey
  reopenUrl?: string
}

interface ReopenOptions {
  url: string
}

/**
 * Execute a reset immediately in the current context. Safe for
 * non-destructive module resets from any page; destructive keys ("all",
 * "CHAT_SESSIONS") should go through scheduleDestructiveReset() instead.
 */
export const performAppReset = async (key: ResetKey): Promise<void> => {
  const allKeys = getAllResetKeys()

  if (key === "all" || key === "CHAT_SESSIONS") {
    await resetSQLiteDatabase()
  }

  if (key === "all" || key === "FEEDBACK") {
    await feedbackService.clearAllFeedback()
  }

  if (key === "all") {
    await withProviderPersistenceLock(async () => {
      await resetProviderStorageUnlocked(allKeys.PROVIDER || [])
      await plasmoGlobalStorage.clear()
      await plasmoDeviceStorage.clear()
    })
    if (typeof sessionStorage !== "undefined") {
      sessionStorage.clear()
    }
  } else if (key !== "CHAT_SESSIONS" && key !== "FEEDBACK") {
    const keysToRemove = allKeys[key] || []
    if (keysToRemove.length > 0) {
      if (key === "PROVIDER") {
        await withProviderPersistenceLock(() =>
          resetProviderStorageUnlocked(keysToRemove)
        )
      } else {
        await Promise.all(
          keysToRemove.map((storageKey) => removePlasmoStoredValue(storageKey))
        )
      }
    }
  }
}

/**
 * Persist the reset request and restart the whole extension. The background
 * worker picks the flag up on boot via resumePendingAppLifecycle().
 */
export const scheduleDestructiveReset = async (
  key: ResetKey,
  reopenUrl?: string
): Promise<void> => {
  const pending: PendingReset = { key, reopenUrl }
  await chrome.storage.local.set({
    [STORAGE_KEYS.APP_LIFECYCLE.PENDING_RESET]: pending
  })
  browser.runtime.reload()
}

/**
 * Restart the whole extension and reopen the given options URL afterward.
 * Used by flows (backup import) that changed persisted state under every
 * context and need a clean restart without looking like a crash.
 */
export const scheduleReloadWithReopen = async (url: string): Promise<void> => {
  const reopen: ReopenOptions = { url }
  await chrome.storage.local.set({
    [STORAGE_KEYS.APP_LIFECYCLE.REOPEN_OPTIONS]: reopen
  })
  browser.runtime.reload()
}

const reopenOptionsPage = async (url: string | undefined): Promise<void> => {
  try {
    if (url) {
      await browser.tabs.create({ url })
      return
    }
    await browser.runtime.openOptionsPage()
  } catch (error) {
    logger.warn("Failed to reopen options page after reload", "AppReset", {
      error
    })
  }
}

/**
 * Background-boot hook: finish a scheduled destructive reset and/or reopen
 * the options page. Must run before any other startup task opens the chat
 * database, otherwise deleteDatabase blocks again.
 */
export const resumePendingAppLifecycle = async (): Promise<void> => {
  const stored = await chrome.storage.local.get([
    STORAGE_KEYS.APP_LIFECYCLE.PENDING_RESET,
    STORAGE_KEYS.APP_LIFECYCLE.REOPEN_OPTIONS
  ])

  const pending = stored[STORAGE_KEYS.APP_LIFECYCLE.PENDING_RESET] as
    | PendingReset
    | undefined
  const reopen = stored[STORAGE_KEYS.APP_LIFECYCLE.REOPEN_OPTIONS] as
    | ReopenOptions
    | undefined

  // Clear flags first so a crash mid-reset cannot loop the worker.
  if (pending || reopen) {
    await chrome.storage.local.remove([
      STORAGE_KEYS.APP_LIFECYCLE.PENDING_RESET,
      STORAGE_KEYS.APP_LIFECYCLE.REOPEN_OPTIONS
    ])
  }

  if (pending) {
    try {
      await performAppReset(pending.key)
      logger.info(
        `Completed scheduled reset: ${String(pending.key)}`,
        "AppReset"
      )
    } catch (error) {
      logger.error("Scheduled reset failed", "AppReset", { error })
    }
    await reopenOptionsPage(pending.reopenUrl)
    return
  }

  if (reopen) {
    await reopenOptionsPage(reopen.url)
  }
}
