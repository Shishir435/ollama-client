import type { ToolContext } from "@/lib/tools/types"
import type { ChatMessage, ChatWithModelMessage } from "@/types"

/**
 * Whether an earlier turn of the conversation brought in text the user did
 * not write: an attachment, a tool result, retrieved context, an attached tab
 * or an agent run. That text is in the history the model reads now, so a
 * browser task it writes in this turn may be repeating it. The current turn's
 * own context is judged by the caller that built it.
 */
export const historyCarriesReadContent = (messages: ChatMessage[]): boolean =>
  messages.some(
    (message) =>
      message.role === "tool" ||
      Boolean(message.agentRunId || message.agentHandoff) ||
      (message.attachments?.length ?? 0) > 0 ||
      (message.metrics?.toolRuns?.length ?? 0) > 0 ||
      (message.metrics?.ragSources?.length ?? 0) > 0 ||
      (message.metrics?.usedContextChunks?.length ?? 0) > 0 ||
      (message.metrics?.tabContextLength ?? 0) > 0 ||
      (message.metrics?.ragContextLength ?? 0) > 0
  )

/** The newest browser-agent run in the branch, which a follow-up continues. */
const previousAgentRunId = (messages: ChatMessage[]): string | undefined =>
  [...messages].reverse().find((message) => message.agentRunId)?.agentRunId

/**
 * What a tool may know about the turn calling it. The durable-turn fields are
 * absent on the legacy port path, and the tools that need them refuse there.
 */
export const buildToolContext = (
  msg: ChatWithModelMessage,
  conversationMessages: ChatMessage[],
  signal: AbortSignal
): ToolContext => {
  const { payload } = msg
  const previousRunId = previousAgentRunId(conversationMessages)
  return {
    signal,
    sessionId: payload.sessionId,
    model: payload.model,
    ...(payload.providerId ? { providerId: payload.providerId } : {}),
    ...(payload.assistantMessageId !== undefined
      ? { assistantMessageId: payload.assistantMessageId }
      : {}),
    ...(payload.browserTabId !== undefined
      ? { browserTabId: payload.browserTabId }
      : {}),
    pageContentInContext:
      payload.pageContentInContext === true ||
      historyCarriesReadContent(conversationMessages),
    ...(previousRunId ? { previousAgentRunId: previousRunId } : {}),
    ...(payload.agentFollowUpRunId
      ? { followUpRunId: payload.agentFollowUpRunId }
      : {})
  }
}
