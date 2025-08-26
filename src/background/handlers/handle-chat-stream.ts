import {
  processRemainingMetricsBuffer,
  processStreamChunk
} from "@/background/lib/process-stream-chunk"
import { safePostMessage } from "@/background/lib/utils"
import type { ChromePort, PortStatusFunction } from "@/types"

export const handleChatStream = async (
  response: Response,
  port: ChromePort,
  isPortClosed: PortStatusFunction
): Promise<void> => {
  if (!response.body) {
    console.error("No response body received")
    safePostMessage(port, {
      error: {
        status: 0,
        message: "No response from model - try regenerating"
      }
    })
    return
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder("utf-8")
  let fullText = ""
  let buffer = ""
  let hasReceivedData = false

  let timeoutId: NodeJS.Timeout | null = null

  try {
    timeoutId = setTimeout(() => {
      if (!hasReceivedData) {
        console.warn("No data received within 60 seconds, aborting")
        reader.cancel().catch(console.error)
        safePostMessage(port, {
          error: {
            status: 0,
            message: "Request timeout - try regenerating"
          }
        })
      }
    }, 60000)

    while (true) {
      const { value, done } = await reader.read()
      if (done) {
        if (timeoutId) clearTimeout(timeoutId)
        break
      }

      if (!hasReceivedData) {
        hasReceivedData = true
        if (timeoutId) clearTimeout(timeoutId)
        console.log("[Handle chat stream]First data chunk received")
      }

      if (isPortClosed()) {
        reader.cancel().catch(console.error)
        if (timeoutId) clearTimeout(timeoutId)
        break
      }

      const processResult = processStreamChunk(
        value,
        decoder,
        buffer,
        fullText,
        port
      )
      buffer = processResult.buffer
      fullText = processResult.fullText

      if (processResult.isDone) {
        if (timeoutId) clearTimeout(timeoutId)
        return
      }
    }

    if (buffer.trim() && !isPortClosed()) {
      processRemainingMetricsBuffer(buffer, fullText, port)
    }
  } catch (error) {
    console.error("Stream processing error:", error)
    throw error
  } finally {
    if (timeoutId) clearTimeout(timeoutId)
  }
}
