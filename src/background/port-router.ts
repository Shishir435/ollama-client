import { reconnectDurableTurn } from "@/background/durable-turn-runtime"
import { handleBuildContext } from "@/background/handlers/handle-build-context"
import { handleChatWithModel } from "@/background/handlers/handle-chat-with-model"
import { handleModelPull } from "@/background/handlers/handle-model-pull"
import { handleSelectionAction } from "@/background/handlers/handle-selection-action"
import { handleStartTurn } from "@/background/handlers/handle-start-turn"
import { abortAndClearController } from "@/background/lib/abort-controller-registry"
import {
  registerSelectionBridgePort,
  unregisterSelectionBridgePort
} from "@/background/lib/selection-bridge"
import {
  classifyRuntimeSender,
  isRuntimePortAllowed,
  isRuntimePortMessageAllowed
} from "@/background/runtime-sender-authorization"
import { browser } from "@/lib/browser-api"
import { MESSAGE_KEYS } from "@/lib/constants"
import { logger } from "@/lib/logger"
import {
  parseChatStreamClientEvent,
  parseModelPullClientEvent
} from "@/protocol/streams"
import type { ChromePort, PortStatusFunction } from "@/types"

const extensionUrlPrefix = browser.runtime.getURL("")

let portConnectionSeq = 0

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
    // Port names are shared constants; give each live connection its own
    // abort key so same-named ports (e.g. two windows) never collide.
    port.abortScopeKey = `${port.name}#${++portConnectionSeq}`
    const isSelectionBridgePort = registerSelectionBridgePort(port)

    const getPortStatus: PortStatusFunction = () => isPortClosed

    port.onDisconnect.addListener(() => {
      isPortClosed = true
      if (isSelectionBridgePort) {
        unregisterSelectionBridgePort(port)
      }
      // Abort whatever this connection may have registered: a chat stream
      // (keyed by requestId) and/or a selection action (keyed by scope key).
      if (currentAbortKey && abortCurrentOnDisconnect) {
        abortAndClearController(currentAbortKey)
      }
      if (port.abortScopeKey) abortAndClearController(port.abortScopeKey)
    })

    port.onMessage.addListener(async (message) => {
      const parsed = parseChatStreamClientEvent(message)
      const messageType =
        message &&
        typeof message === "object" &&
        "type" in message &&
        typeof message.type === "string"
          ? message.type
          : ""
      if (
        !isRuntimePortMessageAllowed(
          port.name,
          messageType,
          sender,
          browser.runtime.id,
          extensionUrlPrefix
        )
      ) {
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

      const msg = parsed.data
      if (msg.type === MESSAGE_KEYS.PROVIDER.CHAT_WITH_MODEL) {
        abortCurrentOnDisconnect = true
        currentAbortKey = msg.payload.requestId
        await handleChatWithModel(msg, port, getPortStatus)
      }

      if (msg.type === MESSAGE_KEYS.PROVIDER.START_TURN) {
        currentAbortKey = msg.payload.start.submission.id
        // The sidepanel is an observer after submission. Closing it must not
        // cancel background-owned context building or generation.
        abortCurrentOnDisconnect = false
        await handleStartTurn(msg, port, getPortStatus)
      }

      if (msg.type === MESSAGE_KEYS.PROVIDER.RECONNECT_STREAM) {
        currentAbortKey = msg.payload.requestId
        abortCurrentOnDisconnect = false
        await reconnectDurableTurn(
          msg.payload.requestId,
          msg.payload.afterSeq,
          { port, isPortClosed: getPortStatus }
        )
      }

      if (msg.type === MESSAGE_KEYS.PROVIDER.BUILD_CONTEXT) {
        await handleBuildContext(msg, port, getPortStatus)
      }

      if (msg.type === MESSAGE_KEYS.PROVIDER.STOP_GENERATION) {
        logger.info("Stop generation requested", "BackgroundSW")
        const requestedKey = msg.payload?.requestId
        abortAndClearController(
          requestedKey ?? currentAbortKey ?? port.abortScopeKey ?? port.name
        )
        abortCurrentOnDisconnect = true
      }

      if (msg.type === MESSAGE_KEYS.PROVIDER.START_SELECTION_ACTION) {
        await handleSelectionAction(msg, port, getPortStatus)
      }

      if (msg.type === MESSAGE_KEYS.PROVIDER.CANCEL_SELECTION_ACTION) {
        logger.info("Selection action cancel requested", "BackgroundSW")
        abortAndClearController(port.abortScopeKey ?? port.name)
      }
    })

    if (
      port.name === MESSAGE_KEYS.PROVIDER.PULL_MODEL ||
      port.name === MESSAGE_KEYS.OLLAMA.PULL_MODEL
    ) {
      port.onMessage.addListener(async (message) => {
        const parsed = parseModelPullClientEvent(message)
        const messageType =
          message &&
          typeof message === "object" &&
          "type" in message &&
          typeof message.type === "string"
            ? message.type
            : ""
        if (
          !isRuntimePortMessageAllowed(
            port.name,
            messageType,
            sender,
            browser.runtime.id,
            extensionUrlPrefix
          )
        ) {
          logger.warn(
            "Blocked unauthorized model-pull message",
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
          port.disconnect()
          return
        }
        if (!parsed.success) {
          logger.warn("Blocked invalid model-pull message", "StreamProtocol", {
            portName: port.name,
            type: messageType || "invalid",
            issues: parsed.error.issues.length
          })
          port.disconnect()
          return
        }
        const event = parsed.data
        await handleModelPull(
          event.type === "model_pull_cancel"
            ? { payload: event.payload.model, cancel: true }
            : { payload: event.payload },
          port,
          getPortStatus
        )
      })
    }
  })
}
