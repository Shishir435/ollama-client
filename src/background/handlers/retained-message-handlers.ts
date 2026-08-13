import type { Runtime } from "webextension-polyfill"
import {
  handleJobCompleteNotification,
  handleKeepToolLoopAlive
} from "@/background/handlers/handle-app-messages"
import { handleOpenTabs } from "@/background/handlers/handle-browser-messages"
import { handleGetModels } from "@/background/handlers/handle-get-models"
import {
  handleLoadSelectionOverlay,
  handleSelectionMessage
} from "@/background/handlers/handle-selection-messages"
import { handleToolConfirmation } from "@/background/handlers/handle-tool-confirmation"
import { MESSAGE_KEYS } from "@/lib/constants"
import type { ChromeMessage, SendResponseFunction } from "@/types"

type RetainedMessageHandler = (
  message: ChromeMessage,
  sender: Runtime.MessageSender,
  sendResponse: SendResponseFunction
) => true | undefined

const retainedMessageHandlers = new Map<string, RetainedMessageHandler>([
  [
    MESSAGE_KEYS.PROVIDER.GET_MODELS,
    (_message, _sender, response) => {
      handleGetModels(response)
      return true
    }
  ],
  [
    MESSAGE_KEYS.BROWSER.OPEN_TAB,
    (_message, _sender, response) => handleOpenTabs(response)
  ],
  [
    MESSAGE_KEYS.APP.KEEP_TOOL_LOOP_ALIVE,
    (_message, _sender, response) => handleKeepToolLoopAlive(response)
  ],
  [
    MESSAGE_KEYS.APP.NOTIFY_JOB_COMPLETE,
    (message, _sender, response) =>
      handleJobCompleteNotification(message, response)
  ],
  [
    MESSAGE_KEYS.BROWSER.ADD_SELECTION_TO_CHAT,
    (message, sender, response) =>
      handleSelectionMessage(message, sender.tab, response)
  ],
  [
    MESSAGE_KEYS.BROWSER.LOAD_SELECTION_OVERLAY,
    (message, sender, response) =>
      handleLoadSelectionOverlay(message.payload, sender, response)
  ],
  [
    MESSAGE_KEYS.PROVIDER.CONFIRM_TOOL,
    (message, _sender, response) => handleToolConfirmation(message, response)
  ]
])

export const dispatchRetainedMessage = (
  message: ChromeMessage,
  sender: Runtime.MessageSender,
  sendResponse: SendResponseFunction
): true | undefined =>
  retainedMessageHandlers.get(message.type)?.(message, sender, sendResponse)
