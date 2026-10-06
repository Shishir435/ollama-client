import { z } from "zod"
import { MAX_AGENT_TEXT_CHARS } from "./agent-command"

const name = z.string().min(1).max(500)
const control = {
  name,
  frameId: z.number().int().nonnegative().optional(),
  record: name.optional()
}

/** Optional on older plans. Predicates are fixed before page interaction. */
export const AgentCompletionCheckSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("field"),
      ...control,
      value: z.string().max(MAX_AGENT_TEXT_CHARS)
    })
    .strict(),
  z
    .object({ type: z.literal("checked"), ...control, checked: z.boolean() })
    .strict(),
  z
    .object({
      type: z.literal("selected"),
      ...control,
      value: z.string().max(2_000)
    })
    .strict(),
  z.object({ type: z.literal("url"), url: z.url().max(2_048) }).strict(),
  z.object({ type: z.literal("row"), record: name }).strict(),
  z
    .object({
      type: z.literal("record_state"),
      record: name,
      state: z.enum(["saved", "submitted"])
    })
    .strict()
])
export type AgentCompletionCheck = z.infer<typeof AgentCompletionCheckSchema>
