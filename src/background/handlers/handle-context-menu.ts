import { browser } from "@/lib/browser-api"
import { DEFAULT_CONTEXT_MENU_ID, MESSAGE_KEYS } from "@/lib/constants"
import { logger } from "@/lib/logger"
import type { ChromeSidePanel } from "@/types"

export const initializeContextMenu = () => {
  browser.contextMenus.create(
    {
      id: DEFAULT_CONTEXT_MENU_ID,
      title: "Ask Ollama Client",
      contexts: ["selection"]
    },
    () => {
      if (browser.runtime.lastError) {
        logger.verbose(
          "Context menu already exists or error",
          "initializeContextMenu",
          {
            error: browser.runtime.lastError.message
          }
        )
      }
    }
  )

  browser.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === DEFAULT_CONTEXT_MENU_ID && info.selectionText) {
      // Open sidepanel if possible (Chrome specific)
      if ("sidePanel" in browser) {
        const sidePanel = (browser as unknown as { sidePanel: ChromeSidePanel })
          .sidePanel
        if (sidePanel.open && tab?.windowId) {
          sidePanel.open({ windowId: tab.windowId }).catch((err: unknown) =>
            logger.error("Failed to open sidepanel", "initializeContextMenu", {
              error: err instanceof Error ? err.message : String(err)
            })
          )
        }
      }

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
