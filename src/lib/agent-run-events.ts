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
export const forgetAgentRuns = async (
  event: { sessionId: string } | { messageIds: number[] }
): Promise<void> => {
  if (!AGENT_PREVIEW_ENABLED) return
  if ("messageIds" in event && event.messageIds.length === 0) return
  try {
    await browser.runtime.sendMessage({
      type: MESSAGE_KEYS.AGENT.FORGET_CHAT_ROWS,
      ...event
    })
  } catch (error) {
    logger.warn("Agent was not told its chat rows were deleted", "Agent", {
      name: error instanceof Error ? error.name : typeof error
    })
  }
}
