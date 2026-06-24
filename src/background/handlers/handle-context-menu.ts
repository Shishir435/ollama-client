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
import { setPlasmoStoredValue } from "@/lib/plasmo-global-storage"
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

  // NOTE: the listener is intentionally NOT `async`. `sidePanel.open()` must be
  // called synchronously inside the click's user activation; any `await` before
  // it (e.g. persisting the selection) drops the gesture and Chrome rejects the
  // open. So we open first, then return the async delivery work as a promise.
  browser.contextMenus.onClicked.addListener((info, tab) => {
    if (
      (info.menuItemId === DEFAULT_CONTEXT_MENU_ID ||
        info.menuItemId === LEGACY_CONTEXT_MENU_ID) &&
      info.selectionText
    ) {
      const selectionText = info.selectionText
      openSidePanelDuringGesture(tab)
      return deliverSelection(selectionText)
    }
  })
}

/**
 * Open the side panel within the current user gesture. A context-menu click is a
 * valid gesture for `sidePanel.open()`, but only if called before any `await` —
 * see the listener note above. Chrome-only; no-op where unsupported.
 */
const openSidePanelDuringGesture = (tab?: {
  id?: number
  windowId?: number
}) => {
  const sidePanel = getSidePanel()
  if (!sidePanel?.open || !tab?.windowId) return

  const options = tab.id
    ? { windowId: tab.windowId, tabId: tab.id }
    : { windowId: tab.windowId }

  sidePanel.open(options).catch((err: unknown) => {
    logger.warn("Failed to open sidepanel", "initializeContextMenu", {
      error: getErrorMessage(err)
    })
  })
}

/** Persist + broadcast the selection. Runs after the panel is already opening. */
const deliverSelection = async (selectionText: string) => {
  // Persist so a freshly-mounted sidepanel can pick it up on first render.
  await setPlasmoStoredValue(
    STORAGE_KEYS.BROWSER.PENDING_SELECTION_TEXT,
    selectionText
  )

  postSelectionToSidePanels(selectionText)
  setTimeout(() => {
    postSelectionToSidePanels(selectionText)
  }, 500)

  await browser.runtime
    .sendMessage({
      type: MESSAGE_KEYS.BROWSER.ADD_SELECTION_TO_CHAT,
      payload: selectionText,
      fromBackground: true
    })
    .catch((err) => {
      logger.warn("Could not send selection to chat", "initializeContextMenu", {
        error: err
      })
    })
}
