import { MESSAGE_KEYS } from "@/lib/constants"
import { getErrorMessage } from "@/lib/error-utils"
import { logger } from "@/lib/logger"
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
      logger.warn(
        "Failed to post selection to side panel port",
        "SelectionBridge",
        { error: getErrorMessage(error) }
      )
      selectionBridgePorts.delete(port)
    }
  }
}
