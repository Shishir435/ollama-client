import { safePostMessage } from "@/background/lib/utils"
import type { ChromePort, OllamaChatResponse, StreamChunkResult } from "@/types"

export function processStreamChunk(
  value: Uint8Array,
  decoder: TextDecoder,
  buffer: string,
  fullText: string,
  port: ChromePort
): StreamChunkResult {
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
      const data: OllamaChatResponse = JSON.parse(trimmedLine)

      // Handle streaming content
      if (data.message?.content) {
        const delta = data.message.content
        fullText += delta
        safePostMessage(port, { delta })
      }

      // Handle completion - when done is true, we get the final response with metrics
      if (data.done === true) {
        console.log("Generation completed, total tokens:", fullText.length)
        // Send the final message with metrics
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
        return { buffer, fullText, isDone: true }
      }
    } catch (err) {
      const error = err as Error
      console.warn("Failed to parse chunk line:", trimmedLine, error)
      // If we can't parse multiple chunks, the connection might be corrupted
      if (error.name === "SyntaxError") {
        console.warn(
          "Multiple parse errors detected, connection may be corrupted"
        )
      }
    }
  }

  return { buffer, fullText, isDone: false }
}
