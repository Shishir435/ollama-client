import { safeSendResponse } from "@/background/lib/utils"
import { DEFAULT_MODEL_LIBRARY_BASE_URL } from "@/lib/constants"
import type { SendResponseFunction } from "@/types"

export const handleScrapeModelVariants = async (
  name: string,
  sendResponse: SendResponseFunction
): Promise<void> => {
  try {
    const res = await fetch(
      `${DEFAULT_MODEL_LIBRARY_BASE_URL}/library/${encodeURIComponent(name)}`
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
