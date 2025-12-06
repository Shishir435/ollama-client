import type { ChatMessage } from "@/types"

export interface SessionMetrics {
  /** Total tokens used (prompt + generated) */
  totalTokens: number
  /** Sum of total_duration in nanoseconds */
  totalDuration: number
  /** Average generation speed (tokens per second) */
  averageSpeed: number
  /** Number of completed assistant messages with metrics */
  messageCount: number
  /** Sum of prompt_eval_count */
  promptTokens: number
  /** Sum of eval_count (generated tokens) */
  generatedTokens: number
}

/**
 * Calculate aggregated metrics for a chat session from its messages
 */
export function calculateSessionMetrics(
  messages: ChatMessage[]
): SessionMetrics {
  let totalDuration = 0
  let promptTokens = 0
  let generatedTokens = 0
  let totalEvalDuration = 0
  let messageCount = 0

  for (const msg of messages) {
    // Only count assistant messages with metrics
    if (msg.role !== "assistant" || !msg.done || !msg.metrics) {
      continue
    }

    const m = msg.metrics
    messageCount++

    if (m.total_duration) {
      totalDuration += m.total_duration
    }

    if (m.prompt_eval_count) {
      promptTokens += m.prompt_eval_count
    }

    if (m.eval_count) {
      generatedTokens += m.eval_count
    }

    if (m.eval_duration) {
      totalEvalDuration += m.eval_duration
    }
  }

  const totalTokens = promptTokens + generatedTokens

  // Calculate average speed: tokens / seconds
  // eval_duration is in nanoseconds, convert to seconds
  const evalSeconds = totalEvalDuration / 1_000_000_000
  const averageSpeed = evalSeconds > 0 ? generatedTokens / evalSeconds : 0

  return {
    totalTokens,
    totalDuration,
    averageSpeed,
    messageCount,
    promptTokens,
    generatedTokens
  }
}

/**
 * Format duration from nanoseconds to human-readable string
 */
export function formatSessionDuration(nanoseconds: number): string {
  const seconds = nanoseconds / 1_000_000_000

  if (seconds < 1) {
    return `${Math.round(seconds * 1000)}ms`
  }

  if (seconds < 60) {
    return `${seconds.toFixed(1)}s`
  }

  const minutes = seconds / 60
  return `${minutes.toFixed(1)}m`
}
