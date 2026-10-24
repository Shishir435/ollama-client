import { createAppError } from "@/lib/error-utils"
import type { ChatRequest } from "@/lib/providers/types"

/** A conservative estimate until a provider supplies a local tokenizer. */
const textTokens = (text: string): number => {
  let ascii = 0
  let nonAscii = ""
  for (const character of text) {
    if (character.charCodeAt(0) <= 127) ascii++
    else nonAscii += character
  }
  return Math.ceil(ascii / 3) + new TextEncoder().encode(nonAscii).length
}

/** Refuse an oversized pack intact: never silently lose policy, evidence or tool pairs. */
export const packChatRequest = (
  request: ChatRequest,
  contextWindow: number
): ChatRequest => {
  if (!Number.isFinite(contextWindow)) return request
  const window = Math.max(1, Math.floor(contextWindow))
  const reserve =
    request.num_predict && request.num_predict > 0
      ? request.num_predict
      : Math.min(1024, Math.max(1, Math.floor(window / 4)))
  let inputTokens = 128 + textTokens(JSON.stringify(request.tools ?? []))
  for (const message of request.messages) {
    inputTokens += 24 + textTokens(message.content)
    inputTokens += textTokens(
      JSON.stringify({
        toolCalls: message.toolCalls,
        toolCallId: message.toolCallId,
        replayArtifact: message.replayArtifact,
        thinking: message.thinking
      })
    )
    inputTokens += (message.images?.length ?? 0) * 2048
  }
  // Leave room for provider role markers and tokenizer differences.
  if (Math.ceil(inputTokens * 1.15) + reserve > window)
    throw createAppError(
      "This request exceeds the model context window. This request was not sent. Shorten the conversation or attachments, reduce the output limit, or choose a larger context window.",
      {
        kind: "validation",
        status: 400,
        code: "OLC-CONTEXT-TOO-LARGE",
        messageKey: "chat.errors.request_context_limit",
        userMessage:
          "This request exceeds the model context window. This request was not sent. Shorten the conversation or attachments, reduce the output limit, or choose a larger context window."
      }
    )
  return { ...request, num_predict: reserve }
}
