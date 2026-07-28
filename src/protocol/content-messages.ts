export const CONTENT_MESSAGE_PROTOCOL_VERSION = 1 as const

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
