import { notifyJobComplete } from "@/background/lib/notify"
import { safeSendResponse } from "@/background/lib/utils"
import type { ChromeMessage, SendResponseFunction } from "@/types"

export const handleKeepToolLoopAlive = (
  sendResponse: SendResponseFunction
): undefined => {
  // A visible approval prompt sends this periodically. Runtime messages reset
  // Chromium's MV3 idle timer; SQLite recovery remains the restart fallback.
  safeSendResponse(sendResponse, { success: true })
}

export const handleJobCompleteNotification = (
  message: ChromeMessage,
  sendResponse: SendResponseFunction
): true => {
  const payload = message.payload as
    | { id?: string; title?: unknown; message?: unknown }
    | undefined
  if (
    !payload ||
    typeof payload.title !== "string" ||
    typeof payload.message !== "string"
  ) {
    safeSendResponse(sendResponse, {
      success: false,
      error: { status: 400, message: "Invalid message payload" }
    })
    return true
  }

  notifyJobComplete({
    id: typeof payload.id === "string" ? payload.id : undefined,
    title: payload.title,
    message: payload.message
  })
    .then((result) => {
      safeSendResponse(sendResponse, {
        success: result.sent,
        data: result,
        error: result.sent
          ? undefined
          : { status: 0, message: result.reason || "Notification skipped" }
      })
    })
    .catch((error) => {
      safeSendResponse(sendResponse, {
        success: false,
        error: {
          status: 0,
          message: error instanceof Error ? error.message : String(error)
        }
      })
    })
  return true
}
