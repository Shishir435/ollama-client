import type { ChatMessage } from "@/types"

/** How long the first token may take before the wait is worth explaining. */
export const MODEL_LOAD_HINT_DELAY_MS = 2_000

/**
 * Whether the turn is waiting on the model's first token and nothing else.
 *
 * A model that is not in memory is read from disk before it can answer, which
 * on a large model is most of a minute of apparent silence. That is only the
 * explanation when nothing else could account for the quiet: no text or
 * reasoning yet, no tool call (a tool's own run, or the model reading its
 * result, is not a load), and no context step still running ahead of the
 * request. Run length is for the caller to test; this says only whether the
 * silence is the model's.
 */
export const isAwaitingFirstToken = (message: ChatMessage): boolean => {
  if (message.role !== "assistant") return false
  if (message.content.trim() || message.thinking?.trim()) return false
  const metrics = message.metrics
  if ((metrics?.toolRuns?.length ?? 0) > 0) return false
  return !(metrics?.activityEvents ?? []).some(
    (event) => event.status === "running" && event.kind !== "generating_answer"
  )
}
