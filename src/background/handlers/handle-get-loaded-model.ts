import { getBaseUrl, safeSendResponse } from "@/background/lib/utils"
import type { SendResponseFunction } from "@/types"

export const handleGetLoadedModels = async (
  sendResponse: SendResponseFunction
): Promise<void> => {
  try {
    const baseUrl = await getBaseUrl()

    const res = await fetch(`${baseUrl}/api/ps`)
    if (!res.ok) {
      safeSendResponse(sendResponse, {
        success: false,
        error: { status: res.status, message: res.statusText }
      })
      return
    }

    const data = await res.json()
    safeSendResponse(sendResponse, { success: true, data })
  } catch (err) {
    const error = err as Error
    safeSendResponse(sendResponse, {
      success: false,
      error: { status: 0, message: error.message }
    })
  }
}
