import { safeSendResponse } from "@/background/lib/utils"
import type { SendResponseFunction } from "@/types"

export const handleScrapeModelVariants = async (
  name: string,
  sendResponse: SendResponseFunction
): Promise<void> => {
  try {
    const res = await fetch(
      `https://ollama.com/library/${encodeURIComponent(name)}`
    )
    const html = await res.text()
    safeSendResponse(sendResponse, { success: true, html })
  } catch (err) {
    const error = err as Error
    safeSendResponse(sendResponse, {
      success: false,
      error: { status: 0, message: error.message }
    })
  }
}
