import { getBaseUrl, safeSendResponse } from "@/background/lib/utils"
import type { OllamaTagsResponse, SendResponseFunction } from "@/types"

export const handleGetModels = async (
  sendResponse: SendResponseFunction
): Promise<void> => {
  try {
    const url = await getBaseUrl()
    const OllamaBaseUrl = url ?? "http://localhost:11434"

    const res = await fetch(`${OllamaBaseUrl}/api/tags`)
    if (!res.ok) {
      safeSendResponse(sendResponse, {
        success: false,
        error: { status: res.status, message: res.statusText }
      })
      return
    }

    const data: OllamaTagsResponse = await res.json()
    safeSendResponse(sendResponse, { success: true, data })
  } catch (err) {
    const error = err as Error
    safeSendResponse(sendResponse, {
      success: false,
      error: { status: 0, message: error.message }
    })
  }
}
