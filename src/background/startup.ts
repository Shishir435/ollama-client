import { initializeContextMenu } from "@/background/handlers/handle-context-menu"
import { downloadEmbeddingModelSilently } from "@/background/handlers/handle-embedding-download"
import { updateDNRRules } from "@/background/lib/dnr"
import { browser, isChromiumBased } from "@/lib/browser-api"
import { DEFAULT_EMBEDDING_MODEL, STORAGE_KEYS } from "@/lib/constants"
import { logger } from "@/lib/logger"
import { runEmbeddingDimensionMigration } from "@/lib/migration/embedding-dimension-migration"
import { getPlasmoStoredValue } from "@/lib/plasmo-global-storage"
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
  })
}

export const initializeBackgroundStartup = () => {
  void migrateLegacyProviderStorage()
  void runEmbeddingDimensionMigration()
  initializeContextMenu()
  registerActionHandler()
  registerInstallHandlers()
  registerToolRegistryInvalidation()
}
