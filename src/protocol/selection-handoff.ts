import { z } from "zod"

/**
 * The most selected text one "Add to chat" carries. The selection is quoted
 * into the next message, so the cap keeps a stray select-all from becoming a
 * prompt the model cannot read; the overlay truncates to it before sending.
 */
export const SELECTION_CONTEXT_MAX_CHARS = 8000

/** Existing context-menu selections append; the overlay explicitly asks for a new chat or to add context. */
export const SelectionChatRequestSchema = z.union([
  z.string().trim().min(1),
  z
    .object({
      text: z.string().trim().min(1),
      destination: z.literal("new-chat")
    })
    .strict(),
  /**
   * Add the selection to the open chat as removable context. Where it came
   * from is not part of the request: the background reads it from the sender,
   * so a page cannot name itself something else.
   */
  z
    .object({
      text: z.string().trim().min(1).max(SELECTION_CONTEXT_MAX_CHARS),
      destination: z.literal("context")
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
    .strict(),
  z
    .object({
      kind: z.literal("context"),
      id: z.uuid(),
      text: z.string().min(1).max(SELECTION_CONTEXT_MAX_CHARS),
      title: z.string().max(300).optional(),
      url: z.string().max(2048).optional(),
      windowId: z.number().int().optional()
    })
    .strict()
])

export type SelectionChatRequest = z.infer<typeof SelectionChatRequestSchema>
export type SelectionChatHandoff = z.infer<typeof SelectionChatHandoffSchema>
export type SelectionContextHandoff = Extract<
  SelectionChatHandoff,
  { kind: "context" }
>
