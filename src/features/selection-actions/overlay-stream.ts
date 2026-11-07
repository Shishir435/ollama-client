import {
  makeThinkingParserState,
  splitThinkingDelta,
  type ThinkingParserState
} from "@ollama-client/runtime-core/thinking-stream"
import { MESSAGE_KEYS } from "@/lib/constants"
import { parseSelectionStreamServerEvent } from "@/protocol/streams/selection-stream"
import { STREAM_PROTOCOL_VERSION } from "@/protocol/streams/version"
import type { SelectionActionRequest } from "./types"

export interface StreamChunkResult {
  visibleDelta: string
  thinkingDelta: string
  isThinking: boolean
}

export interface StreamCallbacks {
  onChunk: (result: StreamChunkResult) => void
  onDone: () => void
  /**
   * `messageKey` names a `selection_button.*` translation the overlay renders
   * in place of `message`; the overlay only carries that subtree, so a key from
   * any other part of the catalog is ignored and the text is used instead.
   */
  onError: (message: string, messageKey?: string) => void
}

export function connectSelectionStream(
  request: SelectionActionRequest,
  callbacks: StreamCallbacks
): chrome.runtime.Port {
  const thinkingState: ThinkingParserState = makeThinkingParserState()
  let hasVisibleText = false

  const port = chrome.runtime.connect({
    name: MESSAGE_KEYS.PROVIDER.START_SELECTION_ACTION
  })

  port.onDisconnect.addListener(() => {
    if (chrome.runtime.lastError) {
      callbacks.onError("", "selection_button.panel.connection_lost")
    }
  })

  port.onMessage.addListener((raw) => {
    const parsed = parseSelectionStreamServerEvent(raw)
    if (!parsed.success) return
    const message = parsed.data

    if (message.type === MESSAGE_KEYS.BROWSER.SELECTION_ACTION_CHUNK) {
      const rawDelta = message.payload.delta
      const rawThinkingDelta = message.payload.thinkingDelta
      const { visible, thinking: inlineThinking } = splitThinkingDelta(
        rawDelta,
        thinkingState
      )

      if (visible) hasVisibleText = true

      callbacks.onChunk({
        visibleDelta: visible,
        thinkingDelta: rawThinkingDelta + inlineThinking,
        isThinking:
          !hasVisibleText &&
          (rawThinkingDelta.length > 0 || thinkingState.inThinking)
      })
    }

    if (message.type === MESSAGE_KEYS.BROWSER.SELECTION_ACTION_DONE) {
      callbacks.onDone()
    }

    if (message.type === MESSAGE_KEYS.BROWSER.SELECTION_ACTION_ERROR) {
      const { messageKey, userMessage, message: text } = message.failure
      if (messageKey?.startsWith("selection_button.")) {
        callbacks.onError(userMessage ?? text, messageKey)
      } else if (userMessage || text) {
        callbacks.onError(userMessage || text)
      } else {
        callbacks.onError("", "selection_button.panel.action_failed")
      }
    }
  })

  port.postMessage({
    version: STREAM_PROTOCOL_VERSION,
    type: MESSAGE_KEYS.PROVIDER.START_SELECTION_ACTION,
    payload: request
  })

  return port
}
