import { z } from "zod"

/**
 * Delete one conversation: its runs, row, messages, files and vectors.
 *
 * One request for the whole delete, so a panel that closes right after
 * sending it cannot leave the chat half-deleted: the background finishes the
 * work whether or not the page that asked is still there to hear the answer.
 */
export const SessionsDeleteRequestSchema = z
  .object({ sessionId: z.string().min(1).max(200) })
  .strict()

export const SessionsDeleteResultSchema = z
  .object({ deleted: z.literal(true) })
  .strict()

export type SessionsDeleteRequest = z.infer<typeof SessionsDeleteRequestSchema>
export type SessionsDeleteResult = z.infer<typeof SessionsDeleteResultSchema>
