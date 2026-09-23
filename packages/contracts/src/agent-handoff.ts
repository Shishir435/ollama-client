import { z } from "zod"
import { AgentErrorSchema, MAX_AGENT_FINDING_CHARS } from "./agent"

/** How much of the goal a later turn is reminded of. */
export const MAX_AGENT_HANDOFF_GOAL_CHARS = 1_000
/** How much of the run's own answer a later turn reads. */
export const MAX_AGENT_HANDOFF_RESULT_CHARS = 2_000
/** The run's own notes carried forward, newest last. */
export const MAX_AGENT_HANDOFF_FINDINGS = 6

/**
 * The most text one handoff can hold, derived from its parts so a later bound
 * on the set cannot disagree with them.
 */
export const MAX_AGENT_HANDOFF_CHARS =
  MAX_AGENT_HANDOFF_GOAL_CHARS +
  MAX_AGENT_HANDOFF_RESULT_CHARS +
  MAX_AGENT_HANDOFF_FINDINGS * MAX_AGENT_FINDING_CHARS

/** Settled statuses only: a handoff is written by the commit that settles. */
export const AGENT_HANDOFF_STATUSES = [
  "completed",
  "partial",
  "failed",
  "cancelled"
] as const

/**
 * What a later chat turn is told about a run that happened in its branch.
 *
 * A bounded projection, never the step log: the receipts stay in
 * `agent_steps` for audit, and a follow-up question reads this instead. It
 * carries no screenshot, no form value, no command, no URL and no opaque
 * reasoning — only the goal, the run's answer, how much of the task it could
 * evidence, and the notes it kept. Everything in it except the status is
 * page-derived or model-authored, which is why the context builder fences it
 * rather than letting it speak as part of the conversation.
 *
 * On the message row rather than the run row, so a branch inherits exactly
 * the handoffs of its own ancestry.
 */
export const AgentConversationHandoffSchema = z
  .object({
    version: z.literal(1),
    runId: z.string().min(1).max(200),
    status: z.enum(AGENT_HANDOFF_STATUSES),
    goal: z.string().min(1).max(MAX_AGENT_HANDOFF_GOAL_CHARS),
    result: z.string().min(1).max(MAX_AGENT_HANDOFF_RESULT_CHARS).optional(),
    outcome: z
      .object({
        met: z.number().int().nonnegative(),
        total: z.number().int().nonnegative()
      })
      .strict()
      .optional(),
    failure: AgentErrorSchema.shape.code.optional(),
    findings: z
      .array(z.string().min(1).max(MAX_AGENT_FINDING_CHARS))
      .max(MAX_AGENT_HANDOFF_FINDINGS),
    settledAt: z.number().int().nonnegative()
  })
  .strict()

export type AgentConversationHandoff = z.infer<
  typeof AgentConversationHandoffSchema
>
