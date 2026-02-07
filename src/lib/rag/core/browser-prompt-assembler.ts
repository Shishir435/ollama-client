import { estimateTokens } from "@/lib/embeddings/chunker"
import type {
  PromptAssembleRequest,
  PromptAssembleResponse,
  PromptAssembler
} from "./interfaces"

const buildRetrievedContext = (
  request: PromptAssembleRequest,
  maxContextTokens: number
): { context: string; tokenEstimate: number; truncated: boolean } => {
  if (request.retrieved.chunks.length === 0 || maxContextTokens <= 0) {
    return {
      context: "",
      tokenEstimate: 0,
      truncated: request.retrieved.chunks.length > 0
    }
  }

  const included: string[] = []
  let usedTokens = 0

  for (const item of request.retrieved.chunks) {
    const line = `[${item.chunk.metadata.source || item.chunk.documentId}] ${item.chunk.text}`
    const lineTokens = estimateTokens(line)

    if (usedTokens + lineTokens > maxContextTokens) {
      break
    }

    included.push(line)
    usedTokens += lineTokens
  }

  return {
    context: included.join("\n\n"),
    tokenEstimate: usedTokens,
    truncated: included.length < request.retrieved.chunks.length
  }
}

/**
 * Deterministic prompt assembly with approximate token budgeting.
 */
export class BrowserPromptAssembler implements PromptAssembler {
  assemble(request: PromptAssembleRequest): PromptAssembleResponse {
    const maxPromptTokens = Math.max(
      request.modelContextWindow - request.responseReserveTokens,
      0
    )

    const baseSystemTokens = estimateTokens(request.systemPrompt)
    const userTokens = estimateTokens(request.userPrompt)

    const retrievedBudget = Math.max(
      maxPromptTokens - baseSystemTokens - userTokens,
      0
    )
    const retrievedContext = buildRetrievedContext(request, retrievedBudget)

    const contextMessage = retrievedContext.context
      ? `Retrieved context:\n${retrievedContext.context}`
      : ""

    const contextMessageTokens = contextMessage
      ? estimateTokens(contextMessage)
      : 0
    let usedTokens = baseSystemTokens + userTokens + contextMessageTokens

    const history: Array<{
      role: "system" | "user" | "assistant"
      content: string
    }> = []

    // Keep most recent history first, then reverse for chronological output.
    for (let i = request.chatHistory.length - 1; i >= 0; i--) {
      const message = request.chatHistory[i]
      const messageTokens = estimateTokens(message.content)

      if (usedTokens + messageTokens > maxPromptTokens) {
        continue
      }

      history.push(message)
      usedTokens += messageTokens
    }

    history.reverse()

    const messages: Array<{
      role: "system" | "user" | "assistant"
      content: string
    }> = [{ role: "system", content: request.systemPrompt }]

    if (contextMessage) {
      messages.push({ role: "system", content: contextMessage })
    }

    messages.push(...history)
    messages.push({ role: "user", content: request.userPrompt })

    let truncationReason: PromptAssembleResponse["truncationReason"]
    const historyCount = request.chatHistory.length
    const includedHistoryCount = history.length

    if (retrievedContext.truncated) {
      truncationReason = "context_budget"
    } else if (includedHistoryCount < historyCount) {
      truncationReason = "history_budget"
    }

    return {
      messages,
      contextTokenEstimate: usedTokens,
      truncated: Boolean(truncationReason),
      truncationReason
    }
  }
}
