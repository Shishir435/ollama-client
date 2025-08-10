import { processStreamChunk } from "@/background/handlers/process-stream-chunk"
import { safePostMessage } from "@/background/lib/utils"
import type {
  ChromePort,
  OllamaChatResponse,
  PortStatusFunction
} from "@/types"

export async function handleChatStream(
  response: Response,
  port: ChromePort,
  isPortClosed: PortStatusFunction
): Promise<void> {
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

  // Add timeout for stuck connections - declare timeoutId in proper scope
  let timeoutId: NodeJS.Timeout | null = null

  try {
    timeoutId = setTimeout(() => {
      if (!hasReceivedData) {
        console.warn("No data received within 10 seconds, aborting")
        reader.cancel().catch(console.error)
        safePostMessage(port, {
          error: {
            status: 0,
            message: "Request timeout - try regenerating"
          }
        })
      }
    }, 30000) // 30 second timeout

    while (true) {
      const { value, done } = await reader.read()
      if (done) {
        if (timeoutId) clearTimeout(timeoutId)
        break
      }

      // Mark that we've received data
      if (!hasReceivedData) {
        hasReceivedData = true
        if (timeoutId) clearTimeout(timeoutId)
        console.log("[Handle chat stream]First data chunk received")
      }

      // Check if port is still connected before processing
      if (isPortClosed()) {
        reader.cancel().catch(console.error)
        if (timeoutId) clearTimeout(timeoutId)
        break
      }

      // Process the streaming data
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

    // Process any remaining data in buffer
    if (buffer.trim() && !isPortClosed()) {
      processRemainingBuffer(buffer, fullText, port)
    }
  } catch (error) {
    console.error("Stream processing error:", error)
    throw error
  } finally {
    if (timeoutId) clearTimeout(timeoutId)
  }
}

function processRemainingBuffer(
  buffer: string,
  fullText: string,
  port: ChromePort
): void {
  try {
    const data: OllamaChatResponse = JSON.parse(buffer.trim())
    if (data.done === true) {
      console.log("Final completion from buffer")
      safePostMessage(port, {
        done: true,
        content: fullText,
        metrics: {
          total_duration: data.total_duration,
          load_duration: data.load_duration,
          prompt_eval_count: data.prompt_eval_count,
          prompt_eval_duration: data.prompt_eval_duration,
          eval_count: data.eval_count,
          eval_duration: data.eval_duration
        }
      })
    }
  } catch (parseError) {
    console.warn("Failed to parse final buffer:", buffer, parseError)
  }
}
