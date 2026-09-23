import { browser } from "@/lib/browser-api"
import { MESSAGE_KEYS } from "@/lib/constants"
import { AGENT_PREVIEW_ENABLED } from "@/lib/feature-flags"
import { logger } from "@/lib/logger"

/**
 * Tell the background that chat rows a run may be reporting into are gone.
 *
 * Lives in `lib` rather than in either feature: deleting a conversation is the
 * sessions feature's business and stopping a run is the Agent's, and neither
 * should have to import the other to say so. One-way, because the UI is
 * submitting intent — the durable work belongs to the background.
 *
 * Awaited by its caller, and deliberately so: the background stops the live
 * runs before the rows they report into are taken away, and a delete that ran
 * ahead of the stop would remove the card of an agent still clicking. It is
 * still one-way — what comes back is delivery, not a result.
 *
 * Failure is logged and swallowed. There is nothing the person deleting a chat
 * can do about it, and what a lost event leaves behind is a dangling pointer
 * that startup reconciliation repairs.
 */
/**
 * How many ids one event may carry, matching the background schema's own cap.
 *
 * A deleted subtree has no size limit — a long branch of a long conversation
 * is thousands of rows — and the schema rejects an oversized event before the
 * listener sees it, so the whole cleanup was dropped for exactly the deletes
 * big enough to matter. Sent in bounded batches instead, each one a complete
 * event: the work is idempotent per id, so a batch that fails costs only its
 * own ids.
 */
const MAX_EVENT_MESSAGE_IDS = 10_000

const eventBatches = (
  event: { sessionId: string } | { messageIds: number[] }
): ({ sessionId: string } | { messageIds: number[] })[] => {
  if (!("messageIds" in event)) return [event]
  const batches: { messageIds: number[] }[] = []
  for (
    let offset = 0;
    offset < event.messageIds.length;
    offset += MAX_EVENT_MESSAGE_IDS
  ) {
    batches.push({
      messageIds: event.messageIds.slice(offset, offset + MAX_EVENT_MESSAGE_IDS)
    })
  }
  return batches
}

export const forgetAgentRuns = async (
  event: { sessionId: string } | { messageIds: number[] }
): Promise<void> => {
  if (!AGENT_PREVIEW_ENABLED) return
  if ("messageIds" in event && event.messageIds.length === 0) return
  for (const batch of eventBatches(event)) {
    try {
      await browser.runtime.sendMessage({
        type: MESSAGE_KEYS.AGENT.FORGET_CHAT_ROWS,
        ...batch
      })
    } catch (error) {
      logger.warn("Agent was not told its chat rows were deleted", "Agent", {
        name: error instanceof Error ? error.name : typeof error
      })
    }
  }
}
