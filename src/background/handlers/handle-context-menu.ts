import { browser } from "@/lib/browser-api"
import { DEFAULT_CONTEXT_MENU_ID, MESSAGE_KEYS } from "@/lib/constants"
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
        console.log(
          "Context menu item already exists or error:",
          browser.runtime.lastError.message
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
          sidePanel
            .open({ windowId: tab.windowId })
            .catch((err: unknown) =>
              console.error(
                "Failed to open sidepanel:",
                err instanceof Error ? err.message : String(err)
              )
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
          console.log("Could not send selection to chat:", err)
        })
    }
  })
}
