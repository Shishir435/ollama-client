import { z } from "zod"

import { AgentKeyCombinationSchema } from "./agent-keys"

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
  /**
   * Read-only progressive inspection. An overview is bounded, so a large
   * application's controls do not all travel at once; these ask for more of
   * the page the overview summarised. `inspect` expands one region named by
   * its group, `find` surfaces controls matching a query, and `extract_text`
   * returns the page's whole text — the below-fold document included, which
   * the overview omits. None mutates the page, so all resolve as `read` and
   * never ask approval.
   */
  GroundedCommandSchema.extend({
    type: z.literal("inspect"),
    target: z.string().min(1).max(80)
  }).strict(),
  GroundedCommandSchema.extend({
    type: z.literal("find"),
    query: z.string().min(1).max(100)
  }).strict(),
  GroundedCommandSchema.extend({ type: z.literal("extract_text") }).strict(),
  ElementCommandSchema.extend({ type: z.literal("click") }).strict(),
  /**
   * Pointer actions a synthetic DOM event cannot stand in for. A double click
   * is two native clicks the page may read as one gesture, and a hover is a
   * pointer that arrives and stays — neither exists without a real pointer,
   * so both run on the native input backend where one is attached.
   */
  ElementCommandSchema.extend({ type: z.literal("double_click") }).strict(),
  ElementCommandSchema.extend({ type: z.literal("hover") }).strict(),
  ElementCommandSchema.extend({
    type: z.literal("type"),
    text: z.string().min(1).max(500)
  }).strict(),
  ElementCommandSchema.extend({
    type: z.literal("clear_and_type"),
    text: z.string().max(500)
  }).strict(),
  /**
   * A key or a combination, `Shift+Tab` or `Control+a` included; see
   * `agent-keys.ts` for the grammar. The target must already hold focus.
   */
  ElementCommandSchema.extend({
    type: z.literal("press_key"),
    key: AgentKeyCombinationSchema
  }).strict(),
  ElementCommandSchema.extend({
    type: z.literal("select"),
    value: z.string().max(2_000)
  }).strict(),
  ElementCommandSchema.extend({
    type: z.literal("check")
  }).strict(),
  ElementCommandSchema.extend({ type: z.literal("uncheck") }).strict(),
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
