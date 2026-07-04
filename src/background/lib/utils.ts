import { browser } from "@/lib/browser-api"
import { logger } from "@/lib/logger"
import { resolveProviderBaseUrl } from "@/lib/providers/base-url"
import { ProviderManager } from "@/lib/providers/manager"
import { ProviderId } from "@/lib/providers/types"
import type {
  ChatStreamMessage,
  ChromeMessage,
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
  message: ChatStreamMessage | PullStreamMessage | ChromeMessage
): void => {
  try {
    // Type assertion needed because ChromePort.postMessage expects ChromeMessage
    // ,but we're sending stream messages which don't have a 'type' field
    port.postMessage(
      message as unknown as Parameters<ChromePort["postMessage"]>[0]
    )
  } catch (error) {
    // Port closed or disconnected (e.g., tab in back/forward cache)
    // This is expected and not an error condition
    if (browser.runtime.lastError) {
      logger.debug(
        "Could not send message to port, channel may be closed",
        "BackgroundUtils",
        { error: browser.runtime.lastError.message }
      )
    } else {
      logger.debug("Could not send message to port", "BackgroundUtils", {
        error
      })
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
      logger.debug(
        "Could not send response, channel may be closed",
        "BackgroundUtils",
        { error: browser.runtime.lastError.message }
      )
    } else {
      logger.debug("Could not send response", "BackgroundUtils", { error })
    }
  }
}

export const getBaseUrl = async (): Promise<string> => {
  const config = await ProviderManager.getProviderConfig(ProviderId.OLLAMA)
  if (!config) {
    throw new Error("Built-in Ollama provider configuration is missing")
  }
  return resolveProviderBaseUrl(config)
}

export const getPullAbortControllerKey = (
  portName: string,
  modelName: string
) => {
  return `${portName}:${modelName}`
}
