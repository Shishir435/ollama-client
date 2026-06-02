import { createErrorResponse } from "@/background/lib/error-handler"
import { getBaseUrl, safeSendResponse } from "@/background/lib/utils"
import type { SendResponseFunction } from "@/types"

export const handleDeleteModel = async (
  modelName: string,
  sendResponse: SendResponseFunction
): Promise<void> => {
  try {
    const baseUrl = await getBaseUrl()

    const res = await fetch(`${baseUrl}/api/delete`, {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ model: modelName })
    })

    if (res.ok) {
      safeSendResponse(sendResponse, { success: true })
    } else {
      const errorText = await res.text()
      safeSendResponse(sendResponse, {
        success: false,
        error: {
          status: res.status,
          message: errorText || res.statusText
        }
      })
    }
  } catch (err) {
    safeSendResponse(
      sendResponse,
      createErrorResponse(err, { fallbackMessage: "Unknown error occurred" })
    )
  }
}
