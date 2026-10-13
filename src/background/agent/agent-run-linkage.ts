import type { AgentRunState } from "@ollama-client/contracts"
import { logger } from "@/lib/logger"
import {
  createAgentRun,
  insertAgentRunStatement
} from "@/lib/repositories/agent-runs"
import {
  appendRunTurn,
  attachRunToMessage
} from "@/lib/repositories/chat-history"

/**
 * Where a run's card is drawn. `turn` names the assistant row of the chat turn
 * that delegated the run: that turn wrote the user's message and is streaming
 * into the row, so the run claims the row and writes nothing else.
 */
export type AgentRunPlacement =
  | { kind: "new_turn" }
  | { kind: "turn"; messageId: number }

/**
 * Create a run and the conversation rows that report on it, in one commit.
 *
 * The request the user typed, the assistant row its card is drawn into, and
 * the run itself are written together or not at all. Written separately, each
 * gap between them had its own broken shape: a run with no card, a card
 * pointing at a run that was never created, a reload that lost the task, and a
 * second Start from a panel that had not seen the first one land.
 *
 * A run whose chat cannot be found is not created, and this resolves false.
 * The chat card is where a run is supervised — its approvals, questions and
 * Stop — and chat deletion finds runs by their session, so a run started
 * unlinked after its chat was deleted would act with nothing able to stop it.
 * A start with no chat at all is created unlinked, as before.
 *
 * Whether the chat is there is decided inside that one commit, never before
 * it. Asking first and writing after left a window in which a chat deleted
 * between the two turned the unlinked fallback into a failed start.
 *
 * `parentRunId` names the settled run a follow-up continues. It is written
 * on every path, linked or not: the lineage is a fact about the run, not
 * about where its card is drawn.
 */
export const createLinkedAgentRun = async (
  state: AgentRunState,
  sessionId?: string,
  parentRunId?: string,
  placement: AgentRunPlacement = { kind: "new_turn" }
): Promise<boolean> => {
  const lineage = parentRunId ? { parentRunId } : {}
  if (!sessionId) {
    await createAgentRun(state, lineage)
    return true
  }

  if (placement.kind === "turn") {
    /**
     * No request row: the message that asked is the chat's own, already
     * written by the turn. `requestMessageId` stays empty, which is also what
     * tells startup reconciliation that a turn, not the run, finishes the row.
     */
    const [sql, params] = insertAgentRunStatement(state, {
      sessionId,
      resultMessageId: placement.messageId,
      ...lineage
    })
    if (
      await attachRunToMessage(sessionId, placement.messageId, state.id, {
        sql,
        params
      })
    )
      return true
    logger.warn("Agent run refused without its chat row", "Agent", {
      runId: state.id,
      reason: "message_unavailable"
    })
    return false
  }

  const appended = await appendRunTurn(
    {
      sessionId,
      role: "user",
      content: state.goal,
      timestamp: state.createdAt,
      done: true
    },
    (requestMessageId) => ({
      sessionId,
      role: "assistant",
      /*
       * Empty on purpose: what this row shows is the run, read live from its
       * own durable state. The terminal commit writes the result here as the
       * fallback for anything that reads messages without knowing about runs
       * — an export, a print, a context build.
       */
      content: "",
      model: state.modelId,
      timestamp: state.createdAt,
      parentId: requestMessageId,
      done: false,
      agentRunId: state.id
    }),
    (ids) => {
      const [sql, params] = insertAgentRunStatement(state, {
        sessionId,
        ...ids,
        ...lineage
      })
      return { sql, params }
    }
  )

  if (appended) return true
  logger.warn("Agent run refused without its chat rows", "Agent", {
    runId: state.id,
    reason: "session_missing"
  })
  return false
}
