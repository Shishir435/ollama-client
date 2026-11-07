import type { ChatStreamMessage } from "@/types"

/**
 * The streamed content a provider's final chunk carries beside its `done`.
 *
 * A tool loop holds the provider's `done` back, because the turn is not over
 * until the loop says so. Providers are free to put text on that same chunk —
 * Ollama can send the whole reply on its `done: true` line — so the content is
 * split off and handled like any other delta instead of going down with the
 * terminal flag. Returns null when the chunk carries nothing to show.
 */
export const terminalChunkPayload = (
  chunk: ChatStreamMessage
): ChatStreamMessage | null => {
  const payload: ChatStreamMessage = {}
  if (chunk.delta) payload.delta = chunk.delta
  if (chunk.thinkingDelta) payload.thinkingDelta = chunk.thinkingDelta
  if (chunk.webCitations?.length) payload.webCitations = chunk.webCitations
  if (chunk.generatedImages?.length) {
    payload.generatedImages = chunk.generatedImages
  }
  return Object.keys(payload).length > 0 ? payload : null
}
