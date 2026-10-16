import { z } from "zod"
import {
  AgentErrorSchema,
  AgentPauseReasonSchema,
  AgentPlanEntryOriginSchema,
  AgentRunStatusSchema,
  MAX_AGENT_ALLOWED_ORIGINS,
  MAX_AGENT_CONSTRAINTS,
  MAX_AGENT_OBSERVATION_CEILING,
  MAX_AGENT_REQUIREMENT_CHARS,
  MAX_AGENT_REQUIREMENT_ID_CHARS,
  MAX_AGENT_REQUIREMENTS
} from "./agent"
import { AgentModelReadinessSchema, AgentStepRecordSchema } from "./agent-panel"

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
      .max(MAX_AGENT_OBSERVATION_CEILING)
      .optional(),
    /** Distinct pages the run acted or read on, origin and path. */
    pages: z.number().int().nonnegative().optional(),
    /** How many of the task's requirements the settled run could evidence. */
    outcome: z
      .object({
        met: z.number().int().nonnegative(),
        total: z.number().int().nonnegative(),
        /** Of the met, how many were only seen in a screenshot. */
        visual: z.number().int().positive().optional()
      })
      .strict()
      .optional(),
    /**
     * The run's tab, only while it is still open on a site the run was
     * allowed on — checked when the card is read, since a tab id is reused
     * after a browser restart. What lets a settled card bring the page it
     * worked on forward for review; absent, the card offers no such control.
     */
    tabId: z.number().int().nonnegative().optional(),
    /**
     * The sites the run was allowed on, beside `tabId`, so the click checks
     * the tab again: a settled card stops refreshing, and the tab may have
     * left those sites since it was read.
     */
    tabOrigins: z
      .array(z.string().min(1))
      .max(MAX_AGENT_ALLOWED_ORIGINS)
      .optional(),
    /**
     * What the run was asked to do, as it planned it: each outcome with how
     * it was established once the run settled, and the limits it kept. Shown
     * on every card, so the user reads the run's contract and its grades
     * rather than only the chat model's account of them.
     */
    contract: z
      .object({
        requirements: z
          .array(
            z
              .object({
                id: z.string().min(1).max(MAX_AGENT_REQUIREMENT_ID_CHARS),
                text: z.string().min(1).max(MAX_AGENT_REQUIREMENT_CHARS),
                tier: z
                  .enum(["verified", "supported", "claimed", "unmet"])
                  .optional(),
                origin: AgentPlanEntryOriginSchema.optional()
              })
              .strict()
          )
          .max(MAX_AGENT_REQUIREMENTS),
        constraints: z
          .array(
            z
              .object({
                id: z.string().min(1).max(MAX_AGENT_REQUIREMENT_ID_CHARS),
                text: z.string().min(1).max(MAX_AGENT_REQUIREMENT_CHARS),
                origin: AgentPlanEntryOriginSchema.optional()
              })
              .strict()
          )
          .max(MAX_AGENT_CONSTRAINTS)
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

/** The panel asks whether a model could drive the browser agent at all. */
export const AgentGetReadinessRequestSchema = z
  .object({
    providerId: z.string().min(1).max(200),
    modelId: z.string().min(1).max(200)
  })
  .strict()

/**
 * Two separate answers. `readiness` says whether the model can call tools a
 * step at a time: interface-compatible. `qualified` says whether it has a
 * recorded qualification pass: task-qualified. A model can be the first
 * without the second. `readiness` is absent when the provider is not
 * configured.
 */
export const AgentGetReadinessResultSchema = z
  .object({
    readiness: AgentModelReadinessSchema.optional(),
    qualified: z.boolean()
  })
  .strict()

export type AgentGetReadinessRequest = z.infer<
  typeof AgentGetReadinessRequestSchema
>
export type AgentGetReadinessResult = z.infer<
  typeof AgentGetReadinessResultSchema
>
