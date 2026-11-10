import { MESSAGE_KEYS } from "@/lib/constants"
import { STREAM_PROTOCOL_VERSION } from "@/protocol/streams/version"
import { type SelectionCapture, toSelectionPayload } from "./dom"
import type {
  SelectionOverlayEvent,
  SelectionOverlayState
} from "./overlay-state"
import { connectSelectionStream } from "./overlay-stream"
import type { SelectionActionRequest } from "./types"

export function stopSelectionStream(port: chrome.runtime.Port | null) {
  if (!port) return null

  port.postMessage({
    version: STREAM_PROTOCOL_VERSION,
    type: MESSAGE_KEYS.PROVIDER.CANCEL_SELECTION_ACTION
  })
  port.disconnect()
  return null
}

interface StartSelectionStreamOptions {
  capture: SelectionCapture
  state: SelectionOverlayState
  panelModel: string
  panelProviderId?: string
  dispatch: (event: SelectionOverlayEvent) => void
  onFinish: () => void
}

/** Adapt the selected action and its refinement input to the cancellable content-script stream. */
export function startSelectionActionStream({
  capture,
  state,
  panelModel,
  panelProviderId,
  dispatch,
  onFinish
}: StartSelectionStreamOptions) {
  dispatch({ type: "stream.start" })

  const request: SelectionActionRequest = {
    actionId: state.currentAction,
    selection: toSelectionPayload(capture),
    customInstruction: state.customInstruction,
    ...(state.refinement && { refinement: state.refinement }),
    ...(panelModel && { model: panelModel }),
    ...(panelProviderId && { providerId: panelProviderId })
  }

  let port: chrome.runtime.Port | null = connectSelectionStream(request, {
    onChunk: ({ visibleDelta, thinkingDelta, isThinking }) => {
      dispatch({
        type: "stream.chunk",
        visibleDelta,
        thinkingDelta,
        isThinking
      })
    },
    onDone: () => {
      dispatch({ type: "stream.done" })
      port?.disconnect()
      port = null
      onFinish()
    },
    onError: (message, messageKey) => {
      dispatch({
        type: "stream.error",
        message,
        ...(messageKey && { messageKey })
      })
      port?.disconnect()
      port = null
      onFinish()
    }
  })

  return port
}
