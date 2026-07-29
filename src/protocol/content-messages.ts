export const CONTENT_MESSAGE_PROTOCOL_VERSION = 1 as const
export const SELECTION_OVERLAY_READY_EVENT =
  "ollama-client:selection-overlay-ready:v1"
export const SELECTION_OVERLAY_REQUEST_ID_GLOBAL =
  "__ollamaClientSelectionOverlayRequestIdV1"

export interface SelectionOverlayReadyDetail {
  requestId: string
}

export interface SelectionOverlayLoadRequest {
  version: typeof CONTENT_MESSAGE_PROTOCOL_VERSION
  requestId: string
  document: {
    url: string
    isTopFrame: boolean
  }
}

export interface SelectionOverlayLoadResult {
  requestId: string
  tabId: number
  frameId: number
  documentId?: string
}

export const isSelectionOverlayReadyEvent = (
  event: Event,
  requestId: string
): event is CustomEvent<SelectionOverlayReadyDetail> =>
  event instanceof CustomEvent && event.detail?.requestId === requestId

export const isSelectionOverlayLoadRequest = (
  value: unknown
): value is SelectionOverlayLoadRequest => {
  if (!value || typeof value !== "object") return false
  const request = value as Partial<SelectionOverlayLoadRequest>
  return (
    request.version === CONTENT_MESSAGE_PROTOCOL_VERSION &&
    typeof request.requestId === "string" &&
    request.requestId.length > 0 &&
    typeof request.document?.url === "string" &&
    typeof request.document?.isTopFrame === "boolean"
  )
}
