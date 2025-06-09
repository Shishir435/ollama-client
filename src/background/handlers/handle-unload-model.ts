import { getBaseUrl } from "@/background/lib/utils"
import type { SendResponseFunction } from "@/types"

export async function handleUnloadModel(
  modelName: string,
  sendResponse: SendResponseFunction
): Promise<void> {
  try {
    const url = await getBaseUrl()
    const OllamaBaseUrl = url ?? "http://localhost:11434"

    const res = await fetch(`${OllamaBaseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: modelName,
        messages: [],
        keep_alive: 0
      })
    })

    if (!res.ok) {
      sendResponse({
        success: false,
        error: { status: res.status, message: res.statusText }
      })
      return
    }

    const data = await res.json()
    const wasUnloaded = data.done_reason === "unload"

    sendResponse({ success: wasUnloaded, data })
  } catch (err) {
    const error = err as Error
    sendResponse({
      success: false,
      error: { status: 0, message: error.message }
    })
  }
}
