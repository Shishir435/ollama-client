import { getBaseUrl, safeSendResponse } from "@/background/lib/utils"
import type { SendResponseFunction } from "@/types"

export const handleDeleteModel = async (
  modelName: string,
  sendResponse: SendResponseFunction
): Promise<void> => {
  try {
    const baseUrl = await getBaseUrl()
    const ollamaUrl = baseUrl ?? "http://localhost:11434"

    const res = await fetch(`${ollamaUrl}/api/delete`, {
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
    const error = err as Error
    safeSendResponse(sendResponse, {
      success: false,
      error: {
        status: 0,
        message: error.message || "Unknown error occurred"
      }
    })
  }
}
