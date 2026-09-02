import { classifyRuntimeSender } from "@ollama-client/runtime-core/runtime-sender"
import {
  reconnectDurableTurn,
  requestDurableTurnStop
} from "@/background/durable-turn-runtime"
import { handleBuildContext } from "@/background/handlers/handle-build-context"
import { handleChatWithModel } from "@/background/handlers/handle-chat-with-model"
import { handleSelectionAction } from "@/background/handlers/handle-selection-action"
import { handleStartTurn } from "@/background/handlers/handle-start-turn"
import { abortAndClearController } from "@/background/lib/abort-controller-registry"
import {
  registerSelectionBridgePort,
  unregisterSelectionBridgePort
} from "@/background/lib/selection-bridge"
import {
  isRuntimePortAllowed,
  isRuntimePortMessageAllowed
} from "@/background/runtime-sender-authorization"
import { browser } from "@/lib/browser-api"
import { MESSAGE_KEYS } from "@/lib/constants"
import { logger } from "@/lib/logger"
import { getMessageType } from "@/protocol/message-type"
import {
  type ChatStreamClientEvent,
  parseChatStreamClientEvent
} from "@/protocol/streams"
import type { ChromePort, PortStatusFunction } from "@/types"

const extensionUrlPrefix = browser.runtime.getURL("")

let portConnectionSeq = 0

const warnUnauthorizedMessage = (
  port: ChromePort,
  sender: Parameters<typeof classifyRuntimeSender>[0],
  messageType: string
): void => {
  logger.warn(
    "Blocked unauthorized runtime port message",
    "RuntimeAuthorization",
    {
      portName: port.name,
      type: messageType || "invalid",
      surface: classifyRuntimeSender(
        sender,
        browser.runtime.id,
        extensionUrlPrefix
      ),
      tabId: sender.tab?.id
    }
  )
}

export const registerPortRouter = () => {
  browser.runtime.onConnect.addListener((rawPort) => {
    const port = rawPort as unknown as ChromePort
    const sender = rawPort.sender ?? {}

    if (
      !isRuntimePortAllowed(
        port.name,
        sender,
        browser.runtime.id,
        extensionUrlPrefix
      )
    ) {
      logger.warn("Blocked unauthorized runtime port", "RuntimeAuthorization", {
        portName: port.name,
        surface: classifyRuntimeSender(
          sender,
          browser.runtime.id,
          extensionUrlPrefix
        ),
        tabId: sender.tab?.id
      })
      port.disconnect()
      return
    }

    let isPortClosed = false
    let currentAbortKey: string | undefined
    let abortCurrentOnDisconnect = true
    port.abortScopeKey = `${port.name}#${++portConnectionSeq}`
    const isSelectionBridgePort = registerSelectionBridgePort(port)
    const getPortStatus: PortStatusFunction = () => isPortClosed

    port.onDisconnect.addListener(() => {
      isPortClosed = true
      if (isSelectionBridgePort) unregisterSelectionBridgePort(port)
      if (currentAbortKey && abortCurrentOnDisconnect) {
        abortAndClearController(currentAbortKey)
      }
      if (port.abortScopeKey) abortAndClearController(port.abortScopeKey)
    })

    const dispatchMessage = async (
      msg: ChatStreamClientEvent
    ): Promise<void> => {
      switch (msg.type) {
        case MESSAGE_KEYS.PROVIDER.CHAT_WITH_MODEL:
          abortCurrentOnDisconnect = true
          currentAbortKey = msg.payload.requestId
          await handleChatWithModel(msg, port, getPortStatus)
          return
        case MESSAGE_KEYS.PROVIDER.START_TURN:
          currentAbortKey = msg.payload.start.submission.id
          abortCurrentOnDisconnect = false
          await handleStartTurn(msg, port, getPortStatus)
          return
        case MESSAGE_KEYS.PROVIDER.RECONNECT_STREAM:
          currentAbortKey = msg.payload.requestId
          abortCurrentOnDisconnect = false
          await reconnectDurableTurn(
            msg.payload.requestId,
            msg.payload.afterSeq,
            { port, isPortClosed: getPortStatus }
          )
          return
        case MESSAGE_KEYS.PROVIDER.BUILD_CONTEXT:
          currentAbortKey = msg.payload.requestId
          abortCurrentOnDisconnect = true
          await handleBuildContext(msg, port, getPortStatus)
          return
        case MESSAGE_KEYS.PROVIDER.STOP_GENERATION: {
          logger.info("Stop generation requested", "BackgroundSW")
          const abortKey =
            msg.payload?.requestId ??
            currentAbortKey ??
            port.abortScopeKey ??
            port.name
          await requestDurableTurnStop(abortKey)
          abortAndClearController(abortKey)
          abortCurrentOnDisconnect = true
          return
        }
        case MESSAGE_KEYS.PROVIDER.START_SELECTION_ACTION:
          await handleSelectionAction(msg, port, getPortStatus)
          return
        case MESSAGE_KEYS.PROVIDER.CANCEL_SELECTION_ACTION:
          logger.info("Selection action cancel requested", "BackgroundSW")
          abortAndClearController(port.abortScopeKey ?? port.name)
      }
    }

    port.onMessage.addListener(async (message) => {
      const parsed = parseChatStreamClientEvent(message)
      const messageType = getMessageType(message) ?? ""
      if (
        !isRuntimePortMessageAllowed(
          port.name,
          messageType,
          sender,
          browser.runtime.id,
          extensionUrlPrefix
        )
      ) {
        warnUnauthorizedMessage(port, sender, messageType)
        port.disconnect()
        return
      }

      if (!parsed.success) {
        logger.warn("Blocked invalid runtime port message", "StreamProtocol", {
          portName: port.name,
          type: messageType || "invalid",
          issues: parsed.error.issues.length
        })
        port.disconnect()
        return
      }

      await dispatchMessage(parsed.data)
    })
  })
}
