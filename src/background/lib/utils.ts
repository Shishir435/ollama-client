import { browser } from "@/lib/browser-api"
import { STORAGE_KEYS } from "@/lib/constants"
import { plasmoGlobalStorage } from "@/lib/plasmo-global-storage"
import type {
  ChatStreamMessage,
  ChromePort,
  ChromeResponse,
  PullStreamMessage,
  SendResponseFunction
} from "@/types"

/**
 * Safely calls port.postMessage, handling cases where the port
 * is closed or disconnected (e.g., when tabs are in back/forward cache).
 */
export const safePostMessage = (
  port: ChromePort,
  message: ChatStreamMessage | PullStreamMessage
): void => {
  try {
    // Type assertion needed because ChromePort.postMessage expects ChromeMessage
    // but we're sending stream messages which don't have a 'type' field
    port.postMessage(
      message as unknown as Parameters<ChromePort["postMessage"]>[0]
    )
  } catch (error) {
    // Port closed or disconnected (e.g., tab in back/forward cache)
    // This is expected and not an error condition
    if (browser.runtime.lastError) {
      console.debug(
        "Could not send message to port, channel may be closed:",
        browser.runtime.lastError.message
      )
    } else {
      console.debug("Could not send message to port:", error)
    }
  }
}

/**
 * Safely calls sendResponse, handling cases where the message channel
 * is closed (e.g., when tabs are in back/forward cache).
 */
export const safeSendResponse = (
  sendResponse: SendResponseFunction,
  response: ChromeResponse
): void => {
  try {
    sendResponse(response)
  } catch (error) {
    // Message channel closed (e.g., tab in back/forward cache)
    // This is expected and not an error condition
    if (browser.runtime.lastError) {
      console.debug(
        "Could not send response, channel may be closed:",
        browser.runtime.lastError.message
      )
    } else {
      console.debug("Could not send response:", error)
    }
  }
}

export const getBaseUrl = async (): Promise<string> => {
  return (
    ((await plasmoGlobalStorage.get(STORAGE_KEYS.OLLAMA.BASE_URL)) as string) ??
    "http://localhost:11434"
  )
}

export const getPullAbortControllerKey = (
  portName: string,
  modelName: string
) => {
  return `${portName}:${modelName}`
}
