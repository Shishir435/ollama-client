import { z } from "zod"

import { MESSAGE_KEYS } from "@/lib/constants"
import { logger } from "@/lib/logger"
import {
  deleteAgentRunsForSession,
  listLiveAgentRunsForMessages,
  listLiveAgentRunsForSession,
  orphanAgentRunMessages
} from "@/lib/repositories/agent-runs"

/** Stops a run the way the panel's own Stop does, so it detaches and settles. */
export type StopAgentRun = (runId: string) => Promise<void>

const stopAll = async (
  runIds: string[],
  stop: StopAgentRun,
  reason: string
): Promise<void> => {
  for (const runId of runIds) {
    try {
      await stop(runId)
    } catch (error) {
      /*
       * A run that cannot be stopped must not block the cleanup of the rest.
       * It stays live and keeps its receipts; what it loses is its card, which
       * the user has just deleted anyway.
       */
      logger.warn(
        "Agent run could not be stopped for a deleted chat",
        "Agent",
        {
          runId,
          reason,
          name: error instanceof Error ? error.name : typeof error
        }
      )
    }
  }
}

/**
 * A branch of a conversation was deleted.
 *
 * Live runs reporting into it are stopped first — a run whose card is gone
 * would keep driving a browser tab and writing to a row nobody can read, which
 * is the worst of both: the effects continue and the evidence does not. The
 * rows themselves are kept and their message pointers dropped, because
 * deleting part of a conversation is not a request to destroy what the agent
 * did in the world.
 */
export const forgetAgentRunsForMessages = async (
  messageIds: number[],
  stop: StopAgentRun
): Promise<void> => {
  if (messageIds.length === 0) return
  await stopAll(
    await listLiveAgentRunsForMessages(messageIds),
    stop,
    "messages_deleted"
  )
  await orphanAgentRunMessages(messageIds)
}

/**
 * A whole chat was deleted, which is the opposite answer: the runs and their
 * receipts go with it. In a product whose claim is that nothing leaves the
 * device, a browsing record that outlives the conversation it belongs to is
 * the wrong default.
 */
export const forgetAgentRunsForSession = async (
  sessionId: string,
  stop: StopAgentRun
): Promise<void> => {
  await stopAll(
    await listLiveAgentRunsForSession(sessionId),
    stop,
    "session_deleted"
  )
  await deleteAgentRunsForSession(sessionId)
}

/**
 * The one-way event a conversation sends when it deletes rows a run may be
 * reporting into.
 *
 * Strict, and one of the two shapes only: a message telling the background to
 * delete every run of a session is not one it should be able to misread as a
 * branch cleanup, or as nothing at all.
 */
export const AgentForgetChatRowsSchema = z.union([
  z
    .object({
      type: z.literal(MESSAGE_KEYS.AGENT.FORGET_CHAT_ROWS),
      sessionId: z.string().min(1).max(200)
    })
    .strict(),
  z
    .object({
      type: z.literal(MESSAGE_KEYS.AGENT.FORGET_CHAT_ROWS),
      messageIds: z.array(z.number().int().nonnegative()).min(1).max(10_000)
    })
    .strict()
])

export type AgentForgetChatRows = z.infer<typeof AgentForgetChatRowsSchema>

export const applyAgentForgetChatRows = async (
  event: AgentForgetChatRows,
  stop: StopAgentRun
): Promise<void> => {
  if ("sessionId" in event) {
    await forgetAgentRunsForSession(event.sessionId, stop)
    return
  }
  await forgetAgentRunsForMessages(event.messageIds, stop)
}
