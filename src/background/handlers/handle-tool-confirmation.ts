import { safeSendResponse } from "@/background/lib/runtime-delivery"
import { resolveToolConfirmation } from "@/background/lib/tool-confirmation-registry"
import type { ChromeMessage, SendResponseFunction } from "@/types"

export const handleToolConfirmation = (
  message: ChromeMessage,
  sendResponse: SendResponseFunction
): undefined => {
  const payload = message.payload as
    | { callId?: unknown; approved?: unknown; scope?: unknown }
    | undefined
  const valid = typeof payload?.callId === "string"
  if (valid) {
    const scope =
      payload?.scope === "session" || payload?.scope === "always"
        ? payload.scope
        : undefined
    resolveToolConfirmation(
      payload.callId as string,
      payload?.approved === true,
      scope
    )
  }
  // Respond synchronously — returning true without ever calling sendResponse
  // makes the sender's promise reject when the message port closes.
  safeSendResponse(sendResponse, { success: valid })
}
