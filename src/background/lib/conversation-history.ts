import type { ChatMessage } from "@/types"

/**
 * Whether an earlier assistant row carries anything for the model to read.
 *
 * A reply the model left empty, or that held only reasoning, is stored as
 * `content: ""` so the bubble can say so. Sending it back gives the next
 * request an assistant turn with no content, which strict chat templates and
 * OpenAI-compatible servers reject. The bubble's notice is rendered from the
 * row's flags and never stored, so dropping the row drops nothing the model
 * saw. A row with tool calls, images or an agent run still counts: its
 * content is not the only thing it replays.
 */
const carriesReplay = (message: ChatMessage): boolean =>
  message.role !== "assistant" ||
  message.content.trim().length > 0 ||
  (message.toolCalls?.length ?? 0) > 0 ||
  (message.images?.length ?? 0) > 0 ||
  Boolean(message.agentRunId || message.agentHandoff)

/**
 * What stands in for an empty reply that sat between two user turns.
 *
 * Dropping such a row would leave two user turns in a row — a stop before the
 * first token, or a provider error, followed by another question — and strict
 * chat templates (Gemma, Mistral under llama.cpp `--jinja`, LM Studio, vLLM)
 * reject that with "Conversation roles must alternate". Merging the two user
 * turns instead would rewrite what the user sent and fold their attachments
 * together, so the turn is kept with a neutral marker the model can read. It is
 * model-facing only: it is never the bubble's notice text, and nothing stores it.
 */
export const EMPTY_REPLY_PLACEHOLDER = "(no reply)"

/**
 * The history a provider request carries: every row with something to say.
 *
 * An empty assistant row is dropped unless that would make two user turns
 * adjacent; then it is replaced by `EMPTY_REPLY_PLACEHOLDER`, carrying none of
 * the row's reasoning or replay artifacts.
 */
export const replayableHistory = (
  messages: readonly ChatMessage[]
): ChatMessage[] => {
  const kept: ChatMessage[] = []
  messages.forEach((message, index) => {
    if (carriesReplay(message)) {
      kept.push(message)
      return
    }
    const previous = kept.at(-1)
    const next = messages[index + 1]
    if (previous?.role === "user" && next?.role === "user") {
      kept.push({
        ...(message.id ? { id: message.id } : {}),
        role: "assistant",
        content: EMPTY_REPLY_PLACEHOLDER,
        done: true
      })
    }
  })
  return kept
}
