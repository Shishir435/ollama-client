import {
  type AgentForgetChatRowsRequest,
  MAX_AGENT_FORGET_MESSAGE_IDS
} from "@ollama-client/contracts/agent-rpc"
import { RpcMethod } from "@ollama-client/contracts/rpc"

import { AGENT_PREVIEW_ENABLED } from "@/lib/feature-flags"
import { logger } from "@/lib/logger"
import { extensionRpcClient } from "@/protocol/extension-client"

/**
 * A deleted subtree has no size limit — a long branch of a long conversation
 * is thousands of rows — and the schema rejects an oversized request before
 * the server sees it, so the whole cleanup was dropped for exactly the deletes
 * big enough to matter. Sent in bounded batches instead, each one a complete
 * request: the work is idempotent per id, so a batch that fails costs only its
 * own ids.
 */
const requestBatches = (
  request: AgentForgetChatRowsRequest
): AgentForgetChatRowsRequest[] => {
  if (!("messageIds" in request)) return [request]
  const batches: AgentForgetChatRowsRequest[] = []
  for (
    let offset = 0;
    offset < request.messageIds.length;
    offset += MAX_AGENT_FORGET_MESSAGE_IDS
  ) {
    batches.push({
      messageIds: request.messageIds.slice(
        offset,
        offset + MAX_AGENT_FORGET_MESSAGE_IDS
      )
    })
  }
  return batches
}

/**
 * Tell the background that chat rows a run may be reporting into are gone.
 *
 * Lives in `lib` rather than in either feature: deleting a conversation is the
 * sessions feature's business and stopping a run is the Agent's, and neither
 * should have to import the other to say so.
 *
 * A request, and awaited by its caller: the background answers once the live
 * runs are stopped and their rows settled, and a delete that ran ahead of the
 * stop would remove the card of an agent still clicking.
 *
 * Failure is logged and swallowed, and no retry is queued behind it. A run
 * that is driving a browser is holding the background worker alive, so a
 * request that finds no receiver is one no live run was waiting for: what it
 * leaves behind is an unsettled row and a dangling pointer, which is exactly
 * what startup recovery settles and reconciliation repairs. A durable retry
 * queue would carry the same answer to the same place, one boot earlier and
 * one storage key heavier, and it would need its own answer for the boot
 * where the queue itself is lost.
 */
export const forgetAgentRuns = async (
  request: AgentForgetChatRowsRequest
): Promise<void> => {
  if (!AGENT_PREVIEW_ENABLED) return
  if ("messageIds" in request && request.messageIds.length === 0) return
  for (const batch of requestBatches(request)) {
    try {
      await extensionRpcClient.call(RpcMethod.AgentForgetChatRows, batch)
    } catch (error) {
      logger.warn("Agent was not told its chat rows were deleted", "Agent", {
        name: error instanceof Error ? error.name : typeof error
      })
    }
  }
}
