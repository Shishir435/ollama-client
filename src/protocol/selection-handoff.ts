import { z } from "zod"

/** Existing context-menu selections append; the overlay explicitly asks for a new chat. */
export const SelectionChatRequestSchema = z.union([
  z.string().trim().min(1),
  z
    .object({
      text: z.string().trim().min(1),
      destination: z.literal("new-chat")
    })
    .strict()
])

/** The background owns the new session id and scopes delivery to the source window. */
export const SelectionChatHandoffSchema = z.union([
  z.string().trim().min(1),
  z
    .object({
      text: z.string().min(1),
      sessionId: z.uuid(),
      windowId: z.number().int().optional()
    })
    .strict()
])

export type SelectionChatRequest = z.infer<typeof SelectionChatRequestSchema>
export type SelectionChatHandoff = z.infer<typeof SelectionChatHandoffSchema>
