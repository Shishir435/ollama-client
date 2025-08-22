import type { SendResponseFunction } from "@/types"

export const handleScrapeModel = async (
  query: string,
  sendResponse: SendResponseFunction
): Promise<void> => {
  try {
    const res = await fetch(
      `https://ollama.com/search?q=${encodeURIComponent(query)}`
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
