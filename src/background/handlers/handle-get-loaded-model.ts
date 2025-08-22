import { getBaseUrl } from "@/background/lib/utils"
import type { SendResponseFunction } from "@/types"

export const handleGetLoadedModels = async (
  sendResponse: SendResponseFunction
): Promise<void> => {
  try {
    const url = await getBaseUrl()
    const OllamaBaseUrl = url ?? "http://localhost:11434"

    const res = await fetch(`${OllamaBaseUrl}/api/ps`)
    if (!res.ok) {
      sendResponse({
        success: false,
        error: { status: res.status, message: res.statusText }
      })
      return
    }

    const data = await res.json()
    sendResponse({ success: true, data })
  } catch (err) {
    const error = err as Error
    sendResponse({
      success: false,
      error: { status: 0, message: error.message }
    })
  }
}
