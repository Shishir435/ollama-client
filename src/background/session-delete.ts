import type {
  SessionsDeleteRequest,
  SessionsDeleteResult
} from "@ollama-client/contracts/session-rpc"
import { deleteVectors } from "@/lib/embeddings/vector-store"
import { AGENT_PREVIEW_ENABLED } from "@/lib/feature-flags"
import { logger } from "@/lib/logger"
import * as repo from "@/lib/repositories/chat-history"

const forgetSessionRuns = async (sessionId: string): Promise<void> => {
  if (!AGENT_PREVIEW_ENABLED) return
  const { forgetAgentChatRows } =
    await import("@/background/agent/agent-forget-rpc")
  try {
    await forgetAgentChatRows({ sessionId })
  } catch (error) {
    logger.warn("Agent runs of a deleted chat were not stopped", "Agent", {
      name: error instanceof Error ? error.name : typeof error
    })
  }
}

/**
 * Delete a conversation and everything it owns, in the background.
 *
 * The side panel used to run these steps itself, one request at a time, and
 * a panel closed during the Undo window starts them from `pagehide`: the page
 * was gone before the later requests were sent, and the chat came back on the
 * next open. One request carries the whole delete instead, and it runs to the
 * end here whether or not its sender is still alive.
 *
 * The runs of the chat are stopped first and awaited to completion, so a run
 * is never told after its rows have gone. A run started between that answer
 * and the row delete is what the second pass is for: a run is linked in the
 * same transaction that reads the session, so once the row is deleted no new
 * run can claim this chat, and every run that did is collected by asking
 * again.
 *
 * The signal is deliberately not threaded through: a delete stopped halfway
 * leaves a chat with no messages, which is worse than either outcome.
 */
export const deleteSessionData = async ({
  sessionId
}: SessionsDeleteRequest): Promise<SessionsDeleteResult> => {
  await forgetSessionRuns(sessionId)
  await repo.deleteSessionRow(sessionId)
  await repo.deleteMessagesBySession(sessionId)
  await repo.deleteFilesBySession(sessionId)
  await forgetSessionRuns(sessionId)
  try {
    await deleteVectors({ sessionId, type: "chat" })
  } catch (error) {
    logger.error("Failed to delete session embeddings", "sessionDelete", {
      error
    })
  }
  return { deleted: true }
}
