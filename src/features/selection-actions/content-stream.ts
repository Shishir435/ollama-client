import { MESSAGE_KEYS } from "@/lib/constants"
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
  render: (shouldPlace?: boolean) => void
  onFinish: () => void
}

export function startSelectionActionStream({
  capture,
  state,
  panelModel,
  panelProviderId,
  dispatch,
  render,
  onFinish
}: StartSelectionStreamOptions) {
  dispatch({ type: "stream.start" })
  render()

  const request: SelectionActionRequest = {
    actionId: state.currentAction,
    selection: toSelectionPayload(capture),
    customInstruction: state.customInstruction,
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
      render(false)
    },
    onError: (message) => {
      dispatch({ type: "stream.error", message })
      port?.disconnect()
      port = null
      onFinish()
      render(false)
    }
  })

  return port
}
