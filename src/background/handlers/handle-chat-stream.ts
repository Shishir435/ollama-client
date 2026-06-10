import {
  processRemainingMetricsBuffer,
  processStreamChunk
} from "@/background/lib/process-stream-chunk"
import { safePostMessage } from "@/background/lib/utils"
import { logger } from "@/lib/logger"
import type { ChromePort, PortStatusFunction } from "@/types"

export const handleChatStream = async (
  response: Response,
  port: ChromePort,
  isPortClosed: PortStatusFunction
): Promise<string> => {
  if (!response.body) {
    logger.error("No response body received", "handleChatStream")
    safePostMessage(port, {
      error: {
        status: 0,
        message: "No response from model - try regenerating"
      }
    })
    return ""
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
        logger.warn(
          "No data received within 60 seconds, aborting",
          "handleChatStream"
        )
        reader.cancel().catch((err) =>
          logger.error("Failed to cancel reader", "handleChatStream", {
            error: err
          })
        )
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
        logger.verbose("First data chunk received", "handleChatStream")
      }

      if (isPortClosed()) {
        reader.cancel().catch((err) =>
          logger.error("Failed to cancel reader", "handleChatStream", {
            error: err
          })
        )
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
        return fullText
      }
    }

    if (buffer.trim() && !isPortClosed()) {
      processRemainingMetricsBuffer(buffer, fullText, port)
    }

    return fullText
  } catch (error) {
    logger.error("Stream processing error", "handleChatStream", { error })
    throw error
  } finally {
    if (timeoutId) clearTimeout(timeoutId)
  }
}
