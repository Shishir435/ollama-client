import { z } from "zod"

/**
 * The longest destination a command may name, matching the cap an observed
 * link carries. It also bounds the work the egress detector does per command.
 */
export const MAX_AGENT_DESTINATION_URL_CHARS = 2_048

const GroundedCommandSchema = z.object({
  snapshotId: z.string().min(1),
  generation: z.number().int().nonnegative()
})

const ElementCommandSchema = GroundedCommandSchema.extend({
  ref: z.string().min(1)
})

export const AgentCommandSchema = z.discriminatedUnion("type", [
  GroundedCommandSchema.extend({ type: z.literal("read") }).strict(),
  ElementCommandSchema.extend({ type: z.literal("click") }).strict(),
  ElementCommandSchema.extend({
    type: z.literal("type"),
    text: z.string().max(20_000)
  }).strict(),
  ElementCommandSchema.extend({
    type: z.literal("press_key"),
    key: z.enum(["Enter", "Escape", "Tab", "ArrowUp", "ArrowDown"])
  }).strict(),
  ElementCommandSchema.extend({
    type: z.literal("select"),
    value: z.string().max(2_000)
  }).strict(),
  ElementCommandSchema.extend({
    type: z.literal("check"),
    checked: z.boolean()
  }).strict(),
  GroundedCommandSchema.extend({
    type: z.literal("scroll"),
    direction: z.enum(["up", "down", "left", "right"]),
    amount: z.number().finite().positive().max(10_000).optional(),
    ref: z.string().min(1).optional()
  }).strict(),
  GroundedCommandSchema.extend({
    type: z.literal("navigate"),
    url: z.url().max(MAX_AGENT_DESTINATION_URL_CHARS)
  }).strict(),
  GroundedCommandSchema.extend({ type: z.literal("back") }).strict(),
  GroundedCommandSchema.extend({ type: z.literal("forward") }).strict(),
  GroundedCommandSchema.extend({
    type: z.literal("open_tab"),
    url: z.url().max(MAX_AGENT_DESTINATION_URL_CHARS)
  }).strict(),
  GroundedCommandSchema.extend({
    type: z.literal("switch_tab"),
    tabId: z.number().int().nonnegative()
  }).strict(),
  GroundedCommandSchema.extend({
    type: z.literal("wait"),
    condition: z.string().min(1).max(500),
    timeoutMs: z.number().int().positive().max(30_000)
  }).strict()
])
export type AgentCommand = z.infer<typeof AgentCommandSchema>
