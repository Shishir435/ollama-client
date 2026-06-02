import { postSelectionToSidePanels } from "@/background/lib/selection-bridge"
import { browser } from "@/lib/browser-api"
import {
  DEFAULT_CONTEXT_MENU_ID,
  LEGACY_CONTEXT_MENU_ID,
  MESSAGE_KEYS,
  STORAGE_KEYS
} from "@/lib/constants"
import { getErrorMessage } from "@/lib/error-utils"
import { logger } from "@/lib/logger"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"
import type { ChromeSidePanel } from "@/types"

let isContextMenuListenerRegistered = false

const getSidePanel = () => {
  const rawSidePanel = globalThis.chrome?.sidePanel
  if (rawSidePanel?.open) return rawSidePanel as ChromeSidePanel

  if ("sidePanel" in browser) {
    const sidePanel = (browser as unknown as { sidePanel?: ChromeSidePanel })
      .sidePanel
    if (sidePanel?.open) return sidePanel
  }

  return null
}

const removeContextMenu = (id: string) => {
  try {
    const removal = browser.contextMenus.remove(id)
    if (removal && typeof removal.catch === "function") {
      return removal.catch((error) => {
        logger.debug("Context menu cleanup skipped", "initializeContextMenu", {
          error: getErrorMessage(error)
        })
      })
    }

    return Promise.resolve()
  } catch (error) {
    logger.debug("Context menu cleanup skipped", "initializeContextMenu", {
      error: getErrorMessage(error)
    })
    return Promise.resolve()
  }
}

export const initializeContextMenu = () => {
  Promise.all([
    removeContextMenu(DEFAULT_CONTEXT_MENU_ID),
    removeContextMenu(LEGACY_CONTEXT_MENU_ID)
  ]).finally(() => {
    browser.contextMenus.create({
      id: DEFAULT_CONTEXT_MENU_ID,
      title: "Ask Local LLM",
      contexts: ["selection"]
    })
  })

  if (isContextMenuListenerRegistered) {
    return
  }

  isContextMenuListenerRegistered = true

  browser.contextMenus.onClicked.addListener(async (info, tab) => {
    if (
      (info.menuItemId === DEFAULT_CONTEXT_MENU_ID ||
        info.menuItemId === LEGACY_CONTEXT_MENU_ID) &&
      info.selectionText
    ) {
      // 1. Persist selection to storage (so sidepanel can pick it up on mount)
      await plasmoGlobalStorage.set(
        STORAGE_KEYS.BROWSER.PENDING_SELECTION_TEXT,
        info.selectionText
      )
      // Open sidepanel if possible (Chrome specific)
      const sidePanel = getSidePanel()
      if (sidePanel?.open && tab?.windowId) {
        const options = tab.id
          ? { windowId: tab.windowId, tabId: tab.id }
          : { windowId: tab.windowId }

        sidePanel.open(options).catch((err: unknown) => {
          logger.warn("Failed to open sidepanel", "initializeContextMenu", {
            error: getErrorMessage(err)
          })
        })
      }

      postSelectionToSidePanels(info.selectionText)

      setTimeout(() => {
        postSelectionToSidePanels(info.selectionText)
      }, 500)

      browser.runtime
        .sendMessage({
          type: MESSAGE_KEYS.BROWSER.ADD_SELECTION_TO_CHAT,
          payload: info.selectionText,
          fromBackground: true
        })
        .catch((err) => {
          logger.warn(
            "Could not send selection to chat",
            "initializeContextMenu",
            { error: err }
          )
        })
    }
  })
}
