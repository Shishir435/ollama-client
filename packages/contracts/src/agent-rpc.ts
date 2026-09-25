import { z } from "zod"
import {
  AgentErrorSchema,
  AgentPauseReasonSchema,
  AgentRunStatusSchema,
  MAX_AGENT_OBSERVATIONS
} from "./agent"
import { AgentStepRecordSchema } from "./agent-panel"

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

/** A card asks for the run its message reports, by id. */
export const AgentGetRunRequestSchema = z
  .object({ runId: z.string().min(1).max(200) })
  .strict()

/**
 * What a chat card shows of a run, and nothing it does not.
 *
 * A projection rather than the run state: the state carries the controlled
 * tab, grants, answers and deadlines, none of which a line in a conversation
 * has any business holding, and a card that rendered from the full state
 * would start depending on all of it. The error travels as its code and key
 * only — its message is English written for a developer reading a receipt.
 */
export const AgentRunCardSchema = z
  .object({
    id: z.string().min(1),
    goal: z.string().min(1).max(20_000),
    status: AgentRunStatusSchema,
    pauseReason: AgentPauseReasonSchema.optional(),
    stepCount: z.number().int().nonnegative(),
    result: z.string().min(1).max(20_000).optional(),
    error: AgentErrorSchema.pick({ code: true, messageKey: true })
      .strict()
      .optional(),
    /**
     * The run's steps, one per step, so a settled card still says what was
     * clicked. The live card had the log and the settled one dropped it: a
     * run's record vanished at the moment it finished. Without telemetry or
     * page addresses — the card shows what was done, not where the query
     * string pointed.
     */
    steps: z
      .array(AgentStepRecordSchema.omit({ telemetry: true, sourceUrl: true }))
      .max(MAX_AGENT_OBSERVATIONS)
      .optional(),
    /** Distinct pages the run acted or read on, origin and path. */
    pages: z.number().int().nonnegative().optional(),
    /** How many of the task's requirements the settled run could evidence. */
    outcome: z
      .object({
        met: z.number().int().nonnegative(),
        total: z.number().int().nonnegative()
      })
      .strict()
      .optional(),
    updatedAt: z.number().int().nonnegative()
  })
  .strict()

/**
 * Absent when the run is gone — pruned, deleted with its chat, or never
 * readable. The card then falls back to the message's own text, which is
 * what the terminal commit wrote there for exactly this reader.
 */
export const AgentGetRunResultSchema = z
  .object({ run: AgentRunCardSchema.optional() })
  .strict()

export type AgentGetRunRequest = z.infer<typeof AgentGetRunRequestSchema>
export type AgentRunCard = z.infer<typeof AgentRunCardSchema>
export type AgentGetRunResult = z.infer<typeof AgentGetRunResultSchema>
