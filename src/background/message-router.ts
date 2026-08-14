import {
  RPC_CANCEL_MESSAGE_TYPE,
  RPC_REQUEST_MESSAGE_TYPE
} from "@ollama-client/contracts/rpc"
import { classifyRuntimeSender } from "@ollama-client/runtime-core/runtime-sender"
import type { Runtime } from "webextension-polyfill"
import { dispatchRetainedMessage } from "@/background/handlers/retained-message-handlers"
import { safeSendResponse } from "@/background/lib/runtime-delivery"
import {
  handleRpcCancellation,
  handleRpcRequest
} from "@/background/rpc-server"
import { isRuntimeMessageAllowed } from "@/background/runtime-sender-authorization"
import { browser } from "@/lib/browser-api"
import { logger } from "@/lib/logger"
import { getMessageType } from "@/protocol/message-type"
import type { ChromeMessage, SendResponseFunction } from "@/types"

const extensionUrlPrefix = browser.runtime.getURL("")

const respondForbidden = (
  type: string,
  sender: Runtime.MessageSender,
  sendResponse: SendResponseFunction
) => {
  logger.warn("Blocked unauthorized runtime message", "RuntimeAuthorization", {
    type,
    surface: classifyRuntimeSender(
      sender,
      browser.runtime.id,
      extensionUrlPrefix
    ),
    tabId: sender.tab?.id
  })
  safeSendResponse(sendResponse, {
    success: false,
    error: { status: 403, message: "Message not allowed from this context" }
  })
}

export const registerMessageRouter = () => {
  // The polyfill types the sync listener as returning literal `true`, but we use
  // the Chrome idiom of returning `true` only for handled async responses and
  // falling through (undefined) for messages meant for other listeners. Cast to
  // reconcile that mismatch without changing the runtime contract.
  browser.runtime.onMessage.addListener(((
    rawMessage,
    sender,
    sendResponse
  ): true | undefined => {
    const response = sendResponse as SendResponseFunction
    const message = rawMessage as ChromeMessage

    const messageType = getMessageType(message)
    if (
      !messageType ||
      !isRuntimeMessageAllowed(
        messageType,
        sender,
        browser.runtime.id,
        extensionUrlPrefix
      )
    ) {
      respondForbidden(messageType ?? "invalid", sender, response)
      return true
    }

    if (message.type === RPC_CANCEL_MESSAGE_TYPE) {
      handleRpcCancellation(
        rawMessage,
        sender,
        browser.runtime.id,
        extensionUrlPrefix,
        sendResponse
      )
      return true
    }

    if (message.type === RPC_REQUEST_MESSAGE_TYPE) {
      handleRpcRequest(
        rawMessage,
        sender,
        browser.runtime.id,
        extensionUrlPrefix,
        sendResponse
      )
      return true
    }

    return dispatchRetainedMessage(message, sender, response)
  }) as Runtime.OnMessageListener)
}
