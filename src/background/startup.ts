import { initializeContextMenu } from "@/background/handlers/handle-context-menu"
import { downloadEmbeddingModelSilently } from "@/background/handlers/handle-embedding-download"
import { updateDNRRules } from "@/background/lib/dnr"
import { registerOmniboxQuickAsk } from "@/background/lib/omnibox"
import { registerReminderAlarms } from "@/background/lib/reminders"
import { clearModelToolCapabilityCache } from "@/background/lib/resolve-model-tools"
import { registerScheduledJobs } from "@/background/lib/scheduled-jobs"
import { browser, isChromiumBased } from "@/lib/browser-api"
import { DEFAULT_EMBEDDING_MODEL, STORAGE_KEYS } from "@/lib/constants"
import { logger } from "@/lib/logger"
import { runEmbeddingDimensionMigration } from "@/lib/migration/embedding-dimension-migration"
import { getPlasmoStoredValue } from "@/lib/plasmo-global-storage"
import { ProviderStorageKey } from "@/lib/providers/types"
import { pruneStaleToolLoopRuns } from "@/lib/repositories/tool-loop-runs"
import { migrateLegacyProviderStorage } from "@/lib/storage/provider-migration"
import { getToolRegistry } from "@/lib/tools/build-tool-registry"
import type { ChromeSidePanel } from "@/types"

const openClientWindow = () => {
  browser.windows.create({
    url: browser.runtime.getURL("sidepanel.html"),
    type: "popup",
    width: 420,
    height: 640
  })
}

/**
 * Open the chat surface for a tab: the native side panel on Chromium, a popup
 * window on Firefox (or when no window context is available). Used by the
 * toolbar action's `onClicked` (the keyboard hotkey uses the reserved
 * `_execute_action` command, which toggles the panel natively).
 */
const openPanelForTab = (tab?: { id?: number; windowId?: number }) => {
  if (isChromiumBased() && "sidePanel" in browser) {
    const windowId = tab?.windowId
    if (!windowId) {
      openClientWindow()
      return
    }

    const sidePanel = (browser as unknown as { sidePanel: ChromeSidePanel })
      .sidePanel
    sidePanel.open({ windowId, tabId: tab?.id }).catch((error) => {
      logger.warn(
        "Failed to open side panel, falling back to popup",
        "BackgroundSW",
        { error }
      )
      openClientWindow()
    })
    return
  }

  openClientWindow()
}

const registerActionHandler = () => {
  const actionAPI =
    browser.action ||
    (browser as unknown as { browserAction?: typeof browser.action })
      .browserAction

  if (isChromiumBased() && "sidePanel" in browser) {
    const sidePanel = (
      browser as unknown as {
        sidePanel: ChromeSidePanel
      }
    ).sidePanel

    sidePanel
      .setPanelBehavior({ openPanelOnActionClick: true })
      .catch((error: Error) =>
        logger.error("SidePanel error", "BackgroundSW", { error })
      )

    if (actionAPI) {
      actionAPI.onClicked.addListener((tab) => openPanelForTab(tab))
    }
    return
  }

  if (actionAPI) {
    actionAPI.onClicked.addListener(() => {
      openClientWindow()
    })
  }
}

const registerInstallHandlers = () => {
  if (!isChromiumBased()) {
    logger.warn(
      "DNR not available: skipping CORS workaround (likely Firefox)",
      "BackgroundSW"
    )
    return
  }

  browser.runtime.onInstalled.addListener(async (details) => {
    updateDNRRules()

    if (details.reason !== "install") return

    logger.info(
      "Extension installed - downloading embedding model",
      "BackgroundSW"
    )

    const alreadyDownloaded = await getPlasmoStoredValue<boolean>(
      STORAGE_KEYS.EMBEDDINGS.AUTO_DOWNLOADED
    )

    if (alreadyDownloaded) return

    downloadEmbeddingModelSilently(DEFAULT_EMBEDDING_MODEL)
      .then((result) => {
        if (result.success) {
          logger.info(
            `Successfully downloaded embedding model: ${DEFAULT_EMBEDDING_MODEL}`,
            "BackgroundSW"
          )
          return
        }

        logger.warn(
          `Failed to auto-download embedding model: ${result.error}`,
          "BackgroundSW"
        )
      })
      .catch((error) => {
        logger.error("Error during embedding model download", "BackgroundSW", {
          error
        })
      })
  })

  browser.runtime.onStartup.addListener(() => updateDNRRules())
}

const registerToolRegistryInvalidation = () => {
  if (!browser.storage?.onChanged) return

  browser.storage.onChanged.addListener((changes) => {
    if (STORAGE_KEYS.WEB_SEARCH.CONFIG in changes) {
      getToolRegistry().invalidate()
    }
    if (ProviderStorageKey.CONFIG in changes) {
      clearModelToolCapabilityCache()
      void updateDNRRules()
    }
  })
}

export const initializeBackgroundStartup = () => {
  void migrateLegacyProviderStorage()
  // MV3 workers can start without a browser onStartup event (extension reload,
  // event wakeup). Reconcile the request-origin rule on every worker boot.
  void updateDNRRules()
  void runEmbeddingDimensionMigration()
  void pruneStaleToolLoopRuns().catch((error) => {
    logger.warn("Failed to prune stale tool-loop checkpoints", "BackgroundSW", {
      error
    })
  })
  initializeContextMenu()
  registerActionHandler()
  registerInstallHandlers()
  registerToolRegistryInvalidation()
  registerOmniboxQuickAsk(openPanelForTab)
  registerScheduledJobs()
  registerReminderAlarms()
  registerAlarmPermissionReactivation()
}

/**
 * `alarms` is an optional permission (0.11.15). When granted mid-session the API
 * namespace appears, but the startup registration already ran while it was
 * absent and added no listeners. Re-run registration (and re-sync periodic jobs)
 * on grant so reminders/scheduled jobs start working without a restart. The
 * register* functions are idempotent, so a later real SW restart is harmless.
 */
const registerAlarmPermissionReactivation = () => {
  browser.permissions?.onAdded?.addListener((perms) => {
    // `alarms` isn't in the polyfill's optional-permission union (see
    // src/lib/permissions.ts); compare as plain strings.
    const granted = (perms.permissions ?? []) as string[]
    if (!granted.includes("alarms")) return
    // `registerScheduledJobs` re-syncs periodic-job alarms itself, so there's
    // no separate `syncScheduledJobAlarms` call here.
    registerScheduledJobs()
    registerReminderAlarms()
  })
}
