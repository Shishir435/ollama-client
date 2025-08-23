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
    sendResponse({ success: true, html })
  } catch (err) {
    const error = err as Error
    sendResponse({
      success: false,
      error: { status: 0, message: error.message }
    })
  }
}
