import { clearAbortController } from "@/background/lib/abort-controller-registry"
import {
  getPullAbortControllerKey,
  safePostMessage
} from "@/background/lib/utils"
import type {
  ChromePort,
  OllamaPullResponse,
  PortStatusFunction
} from "@/types"

export async function handlePullStream(
  res: Response,
  port: ChromePort,
  isPortClosed: PortStatusFunction,
  modelName: string
): Promise<void> {
  if (!res.body) return

  const reader = res.body.getReader()
  const decoder = new TextDecoder("utf-8")
  let buffer = ""
  const controllerKey = getPullAbortControllerKey(port.name, modelName)

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      // Check if port is still connected
      if (isPortClosed()) {
        reader.cancel().catch(console.error)
        break
      }

      // Accumulate chunks in buffer
      buffer += decoder.decode(value, { stream: true })

      // Process complete lines
      const lines = buffer.split("\n")
      // Keep the last incomplete line in buffer
      buffer = lines.pop() || ""

      for (const line of lines) {
        const trimmedLine = line.trim()
        if (!trimmedLine) continue

        try {
          const data: OllamaPullResponse = JSON.parse(trimmedLine)

          // Handle different response types from Ollama
          if (data.status) {
            safePostMessage(port, { status: data.status })

            // Check for completion - Ollama returns "success" when done
            if (data.status === "success") {
              safePostMessage(port, { done: true })
              clearAbortController(controllerKey)
              return
            }
          }

          // Handle error responses
          if (data.error) {
            safePostMessage(port, { error: data.error })
            clearAbortController(controllerKey)
            return
          }

          // Handle progress updates (downloading, verifying, etc.)
          if (data.completed !== undefined && data.total !== undefined) {
            const progress = Math.round((data.completed / data.total) * 100)
            safePostMessage(port, {
              status: `Downloading: ${progress}%`,
              progress: progress
            })
          }
        } catch (parseError) {
          console.warn("Failed to parse line:", trimmedLine, parseError)
          // Don't send error for parse failures, just log and continue
        }
      }
    }

    // Process any remaining data in buffer
    if (buffer.trim() && !isPortClosed()) {
      try {
        const data: OllamaPullResponse = JSON.parse(buffer.trim())
        if (data.status === "success") {
          safePostMessage(port, { done: true })
        }
      } catch (parseError) {
        console.warn("Failed to parse final buffer:", buffer, parseError)
      }
    }
  } finally {
    clearAbortController(controllerKey)
  }
}
