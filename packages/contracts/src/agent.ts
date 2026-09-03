import { z } from "zod"
import { AgentCommandSchema } from "./agent-command"

export const AGENT_RUN_STATUSES = [
  "submitted",
  "observing",
  "deciding",
  "awaiting_approval",
  "awaiting_takeover",
  "executing",
  "verifying",
  "pause_requested",
  "paused",
  "cancelling",
  "completed",
  "failed",
  "cancelled"
] as const
export const AgentRunStatusSchema = z.enum(AGENT_RUN_STATUSES)
export type AgentRunStatus = z.infer<typeof AgentRunStatusSchema>

export const AGENT_PAUSE_REASONS = [
  "user",
  "panel_closed",
  "unresolved_effect",
  "takeover"
] as const
export const AgentPauseReasonSchema = z.enum(AGENT_PAUSE_REASONS)
export type AgentPauseReason = z.infer<typeof AgentPauseReasonSchema>

export const AGENT_STEP_STATUSES = [
  "planned",
  "approved",
  "executing",
  "executed",
  "verified",
  "rejected",
  "failed",
  "uncertain"
] as const
export const AgentStepStatusSchema = z.enum(AGENT_STEP_STATUSES)
export type AgentStepStatus = z.infer<typeof AgentStepStatusSchema>

export const AgentDecisionSchema = z.discriminatedUnion("type", [
  z
    .object({ type: z.literal("command"), command: AgentCommandSchema })
    .strict(),
  z
    .object({
      type: z.literal("ask_user"),
      question: z.string().min(1).max(2_000)
    })
    .strict(),
  z
    .object({
      type: z.literal("complete"),
      summary: z.string().min(1).max(20_000)
    })
    .strict(),
  z
    .object({ type: z.literal("fail"), reason: z.string().min(1).max(2_000) })
    .strict()
])
export type AgentDecision = z.infer<typeof AgentDecisionSchema>

export const AgentApprovalRequestSchema = z
  .object({
    id: z.string().min(1),
    runId: z.string().min(1),
    stepId: z.string().min(1),
    risk: z.enum(["medium", "high", "critical"]),
    action: z.string().min(1).max(500),
    consequence: z.string().min(1).max(1_000),
    pageEvidence: z.string().max(1_000).optional(),
    createdAt: z.number().int().nonnegative()
  })
  .strict()
export type AgentApprovalRequest = z.infer<typeof AgentApprovalRequestSchema>

export const AgentTakeoverRequestSchema = z
  .object({
    id: z.string().min(1),
    runId: z.string().min(1),
    stepId: z.string().min(1),
    reason: z.enum([
      "authentication",
      "captcha",
      "file_upload",
      "payment",
      "permission_prompt",
      "sensitive_input",
      "unsupported_control"
    ]),
    instruction: z.string().min(1).max(1_000),
    createdAt: z.number().int().nonnegative()
  })
  .strict()
export type AgentTakeoverRequest = z.infer<typeof AgentTakeoverRequestSchema>

export const AgentErrorSchema = z
  .object({
    code: z.enum([
      "budget_exhausted",
      "invalid_decision",
      "model_unavailable",
      "observation_failed",
      "policy_blocked",
      "stale_snapshot",
      "unsupported_page",
      "verification_failed"
    ]),
    message: z.string().min(1).max(1_000),
    retryable: z.boolean()
  })
  .strict()
export type AgentError = z.infer<typeof AgentErrorSchema>

/**
 * Durable accounting for the two active-time deadlines. Wall-clock time spent
 * waiting for approval or takeover is subtracted after the wait is resumed.
 * Keeping the open suspension in the checkpoint makes an MV3 restart during a
 * user wait harmless: recovery can preserve the wait instead of charging it.
 */
export const AgentDeadlineStateSchema = z
  .object({
    runStartedAt: z.number().int().nonnegative(),
    stepStartedAt: z.number().int().nonnegative(),
    runSuspendedMs: z.number().int().nonnegative(),
    stepSuspendedMs: z.number().int().nonnegative(),
    suspendedAt: z.number().int().nonnegative().optional(),
    suspensionKind: z.enum(["approval", "takeover"]).optional()
  })
  .strict()
  .refine(
    (value) =>
      (value.suspendedAt === undefined) ===
      (value.suspensionKind === undefined),
    "A deadline suspension needs both its timestamp and kind"
  )
export type AgentDeadlineState = z.infer<typeof AgentDeadlineStateSchema>

export const AgentRunStateSchema = z
  .object({
    version: z.literal(1),
    id: z.string().min(1),
    goal: z.string().min(1).max(20_000),
    status: AgentRunStatusSchema,
    pauseReason: AgentPauseReasonSchema.optional(),
    stepCount: z.number().int().nonnegative().max(25),
    observationCount: z.number().int().nonnegative(),
    controlledTabId: z.number().int().nonnegative(),
    providerId: z.string().min(1),
    modelId: z.string().min(1),
    allowedOrigins: z.array(z.string().min(1)).max(25),
    error: AgentErrorSchema.optional(),
    deadline: AgentDeadlineStateSchema.optional(),
    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative()
  })
  .strict()
export type AgentRunState = z.infer<typeof AgentRunStateSchema>
