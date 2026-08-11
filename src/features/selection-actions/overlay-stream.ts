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
  onError: (message: string) => void
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
      callbacks.onError("Connection lost. Try again.")
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
      callbacks.onError(
        message.failure.userMessage ??
          message.failure.message ??
          "Selection action failed. Try again."
      )
    }
  })

  port.postMessage({
    version: STREAM_PROTOCOL_VERSION,
    type: MESSAGE_KEYS.PROVIDER.START_SELECTION_ACTION,
    payload: request
  })

  return port
}
