import { safePostMessage } from "@/background/lib/utils"
import { logger } from "@/lib/logger"
import type { ChromePort, OllamaChatResponse, StreamChunkResult } from "@/types"

export const processStreamChunk = (
  value: Uint8Array,
  decoder: TextDecoder,
  buffer: string,
  fullText: string,
  port: ChromePort
): StreamChunkResult => {
  buffer += decoder.decode(value, { stream: true })
  const lines = buffer.split("\n")
  buffer = lines.pop() || ""

  for (const line of lines) {
    const trimmedLine = line.trim()
    if (!trimmedLine) continue

    try {
      const data: OllamaChatResponse = JSON.parse(trimmedLine)

      if (data.message?.content) {
        const delta = data.message.content
        fullText += delta
        safePostMessage(port, { delta })
      }

      if (data.done === true) {
        logger.info("Generation completed", "processStreamChunk", {
          totalTokens: fullText.length
        })
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
      logger.warn("Failed to parse chunk line", "processStreamChunk", {
        error,
        line: trimmedLine
      })
      if (error.name === "SyntaxError") {
        logger.warn(
          "Multiple parse errors detected, connection may be corrupted",
          "processStreamChunk"
        )
      }
    }
  }

  return { buffer, fullText, isDone: false }
}

export const processRemainingMetricsBuffer = (
  buffer: string,
  fullText: string,
  port: ChromePort
): void => {
  try {
    const data: OllamaChatResponse = JSON.parse(buffer.trim())
    if (data.done === true) {
      logger.verbose(
        "Final completion from buffer",
        "processRemainingMetricsBuffer"
      )
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
    logger.warn(
      "Failed to parse final buffer",
      "processRemainingMetricsBuffer",
      { buffer, error: parseError }
    )
  }
}
