import { MESSAGE_KEYS } from "@/lib/constants"
import {
  makeThinkingParserState,
  splitThinkingDelta,
  type ThinkingParserState
} from "@/lib/thinking-parser"
import type { ChromeMessage } from "@/types"
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
    const message = raw as ChromeMessage

    if (message.type === MESSAGE_KEYS.BROWSER.SELECTION_ACTION_CHUNK) {
      const payload = message.payload as
        | { delta?: string; thinkingDelta?: string }
        | undefined

      const rawDelta = payload?.delta ?? ""
      const rawThinkingDelta = payload?.thinkingDelta ?? ""
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
        message.error?.message ?? "Selection action failed. Try again."
      )
    }
  })

  port.postMessage({
    type: MESSAGE_KEYS.PROVIDER.START_SELECTION_ACTION,
    payload: request
  })

  return port
}
