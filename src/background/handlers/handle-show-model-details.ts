import { getBaseUrl } from "@/background/lib/utils"
import type {
  OllamaShowRequest,
  OllamaShowResponse,
  SendResponseFunction
} from "@/types"

export const handleShowModelDetails = async (
  model: string,
  sendResponse: SendResponseFunction
): Promise<void> => {
  try {
    const url = await getBaseUrl()
    const baseUrl = url ?? "http://localhost:11434"

    const requestBody: OllamaShowRequest = { name: model }

    const res = await fetch(`${baseUrl}/api/show`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody)
    })

    if (!res.ok) {
      sendResponse({
        success: false,
        error: { status: res.status, message: res.statusText }
      })
      return
    }

    const data: OllamaShowResponse = await res.json()
    sendResponse({ success: true, data })
  } catch (err) {
    const error = err as Error
    sendResponse({
      success: false,
      error: { status: 0, message: error.message }
    })
  }
}
