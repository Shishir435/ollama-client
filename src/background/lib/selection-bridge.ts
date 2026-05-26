import { MESSAGE_KEYS } from "@/lib/constants"
import type { ChromePort } from "@/types"

const selectionBridgePorts = new Set<ChromePort>()

export const registerSelectionBridgePort = (port: ChromePort) => {
  if (port.name !== MESSAGE_KEYS.BROWSER.SELECTION_BRIDGE_PORT) return false

  selectionBridgePorts.add(port)
  return true
}

export const unregisterSelectionBridgePort = (port: ChromePort) => {
  selectionBridgePorts.delete(port)
}

export const postSelectionToSidePanels = (selectionText: string) => {
  for (const port of selectionBridgePorts) {
    try {
      port.postMessage({
        type: MESSAGE_KEYS.BROWSER.ADD_SELECTION_TO_CHAT,
        payload: selectionText,
        fromBackground: true
      })
    } catch (error) {
      console.warn(
        "Failed to post selection to side panel port:",
        error instanceof Error ? error.message : String(error)
      )
      selectionBridgePorts.delete(port)
    }
  }
}
