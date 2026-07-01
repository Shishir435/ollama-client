import { handleChatWithModel } from "@/background/handlers/handle-chat-with-model"
import { handleEmbedFileChunksPort } from "@/background/handlers/handle-embed-chunks"
import { handleModelPull } from "@/background/handlers/handle-model-pull"
import { handleSelectionAction } from "@/background/handlers/handle-selection-action"
import { abortAndClearController } from "@/background/lib/abort-controller-registry"
import {
  registerSelectionBridgePort,
  unregisterSelectionBridgePort
} from "@/background/lib/selection-bridge"
import type { SelectionActionMessage } from "@/features/selection-actions/types"
import { browser } from "@/lib/browser-api"
import { MESSAGE_KEYS } from "@/lib/constants"
import { logger } from "@/lib/logger"
import type {
  ChatWithModelMessage,
  ChromeMessage,
  ChromePort,
  ModelPullMessage,
  PortStatusFunction
} from "@/types"

export const registerPortRouter = () => {
  browser.runtime.onConnect.addListener((rawPort) => {
    const port = rawPort as unknown as ChromePort
    let isPortClosed = false
    let currentAbortKey: string | undefined
    const isSelectionBridgePort = registerSelectionBridgePort(port)

    const getPortStatus: PortStatusFunction = () => isPortClosed

    port.onDisconnect.addListener(() => {
      isPortClosed = true
      if (isSelectionBridgePort) {
        unregisterSelectionBridgePort(port)
      }
      abortAndClearController(currentAbortKey ?? port.name)
    })

    port.onMessage.addListener(async (message) => {
      const msg = message as ChromeMessage
      if (msg.type === MESSAGE_KEYS.PROVIDER.CHAT_WITH_MODEL) {
        currentAbortKey = (msg as ChatWithModelMessage).payload?.requestId
        await handleChatWithModel(
          msg as ChatWithModelMessage,
          port,
          getPortStatus
        )
      }

      if (msg.type === MESSAGE_KEYS.PROVIDER.STOP_GENERATION) {
        logger.info("Stop generation requested", "BackgroundSW")
        abortAndClearController(currentAbortKey ?? port.name)
      }

      if (msg.type === MESSAGE_KEYS.PROVIDER.START_SELECTION_ACTION) {
        await handleSelectionAction(
          msg as unknown as SelectionActionMessage,
          port,
          getPortStatus
        )
      }

      if (msg.type === MESSAGE_KEYS.PROVIDER.CANCEL_SELECTION_ACTION) {
        logger.info("Selection action cancel requested", "BackgroundSW")
        abortAndClearController(port.name)
      }
    })

    if (
      port.name === MESSAGE_KEYS.PROVIDER.PULL_MODEL ||
      port.name === MESSAGE_KEYS.OLLAMA.PULL_MODEL
    ) {
      port.onMessage.addListener(async (message) => {
        const msg = message as ChromeMessage
        await handleModelPull(msg as ModelPullMessage, port, getPortStatus)
      })
    }

    if (port.name === MESSAGE_KEYS.PROVIDER.EMBED_FILE_CHUNKS) {
      try {
        handleEmbedFileChunksPort(port)
      } catch (err) {
        logger.error(
          "Error attaching embed chunks port handler",
          "BackgroundSW",
          { error: err }
        )
        try {
          port.postMessage({
            status: "error",
            message: err instanceof Error ? err.message : String(err)
          } as unknown as ChromeMessage)
        } catch (e) {
          logger.warn(
            "Port already closed during error response",
            "BackgroundSW",
            { error: e }
          )
        }
        port.disconnect()
      }
    }
  })
}
