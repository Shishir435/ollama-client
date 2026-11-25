import { postSelectionToSidePanels } from "@/background/lib/selection-bridge"
import { stageSelectionContext } from "@/background/lib/selection-context-handoff"
import { browser } from "@/lib/browser-api"
import {
  ADD_SELECTION_CONTEXT_MENU_ID,
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

/**
 * English copy for the default locale, kept here only for contexts without
 * the extension i18n API (unit tests, a missing catalog entry). The shipped
 * text is the `askSelectionMenu` message. `contextMenus.create` rejects an
 * empty title, so the menu must never be created with one.
 */
const DEFAULT_LOCALE_MENU_TITLE = "Ask Ollama Client about this"

const DEFAULT_LOCALE_CONTEXT_MENU_TITLE = "Add selection to chat as context"

const selectionContextMenuTitle = (): string => {
  try {
    return (
      browser.i18n?.getMessage?.("addSelectionContextMenu") ||
      DEFAULT_LOCALE_CONTEXT_MENU_TITLE
    )
  } catch {
    return DEFAULT_LOCALE_CONTEXT_MENU_TITLE
  }
}

const selectionMenuTitle = (): string => {
  try {
    return (
      browser.i18n?.getMessage?.("askSelectionMenu") ||
      DEFAULT_LOCALE_MENU_TITLE
    )
  } catch {
    return DEFAULT_LOCALE_MENU_TITLE
  }
}

const getSidePanel = () => {
  const rawSidePanel = globalThis.chrome?.sidePanel
  if (typeof rawSidePanel?.open === "function")
    return rawSidePanel as ChromeSidePanel

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
    removeContextMenu(LEGACY_CONTEXT_MENU_ID),
    removeContextMenu(ADD_SELECTION_CONTEXT_MENU_ID)
  ]).finally(() => {
    browser.contextMenus.create({
      id: DEFAULT_CONTEXT_MENU_ID,
      title: selectionMenuTitle(),
      contexts: ["selection"]
    })
    browser.contextMenus.create({
      id: ADD_SELECTION_CONTEXT_MENU_ID,
      title: selectionContextMenuTitle(),
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
      info.menuItemId === ADD_SELECTION_CONTEXT_MENU_ID &&
      info.selectionText
    ) {
      openSidePanelDuringGesture(tab)
      return deliverSelectionContext(info.selectionText, tab)
    }
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
export const openSidePanelDuringGesture = (tab?: {
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

/**
 * Stage the selection as chat context and tell the open panels. The tab comes
 * from the click, so the source is the page the text was selected on.
 */
const deliverSelectionContext = async (
  selectionText: string,
  tab: Parameters<typeof stageSelectionContext>[1]
) => {
  try {
    postSelectionToSidePanels(await stageSelectionContext(selectionText, tab))
  } catch (err) {
    logger.warn("Could not stage selection context", "initializeContextMenu", {
      error: getErrorMessage(err)
    })
  }
}

/** Persist + broadcast the selection. Runs after the panel is already opening. */
const deliverSelection = async (selectionText: string) => {
  // Persist so a freshly-mounted sidepanel can pick it up on first render. A
  // storage failure (e.g. quota) shouldn't reject and surface as an unhandled
  // rejection — Chrome ignores this listener's return value — and the live
  // broadcast below still reaches an already-open panel regardless.
  try {
    await setPlasmoStoredValue(
      STORAGE_KEYS.BROWSER.PENDING_SELECTION_TEXT,
      selectionText
    )
  } catch (err) {
    logger.warn(
      "Could not persist pending selection",
      "initializeContextMenu",
      {
        error: getErrorMessage(err)
      }
    )
  }

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
