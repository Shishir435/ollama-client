import { z } from "zod"

/**
 * How many ids one request may carry. The sender batches by this same
 * constant, so its batches and the schema's cap cannot drift apart.
 */
export const MAX_AGENT_FORGET_MESSAGE_IDS = 10_000

/**
 * A conversation deleted rows a run may be reporting into.
 *
 * Strict, and one of the two shapes only: a request telling the background to
 * delete every run of a session is not one it should be able to misread as a
 * branch cleanup, or as nothing at all.
 */
export const AgentForgetChatRowsRequestSchema = z.union([
  z.object({ sessionId: z.string().min(1).max(200) }).strict(),
  z
    .object({
      messageIds: z
        .array(z.number().int().nonnegative())
        .min(1)
        .max(MAX_AGENT_FORGET_MESSAGE_IDS)
    })
    .strict()
])

/**
 * Answered once the live runs are stopped and their rows settled — the delete
 * waits on this, which is why it is a request rather than an event.
 */
export const AgentForgetChatRowsResultSchema = z
  .object({ forgotten: z.literal(true) })
  .strict()

export type AgentForgetChatRowsRequest = z.infer<
  typeof AgentForgetChatRowsRequestSchema
>
export type AgentForgetChatRowsResult = z.infer<
  typeof AgentForgetChatRowsResultSchema
>
