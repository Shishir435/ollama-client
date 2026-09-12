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
  "browser_disconnected",
  "unresolved_effect",
  "takeover",
  /** The model asked the user something and cannot proceed until answered. */
  "question"
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

/**
 * A note the model attaches to the step it is taking, so a fact it read on
 * one page survives into a later decision. Bounded, and page-derived like any
 * other model output: it is recorded as evidence of what the run believed,
 * never as an instruction.
 */
/**
 * Observations a run may take before it is stopped.
 *
 * Declared once because two places need it and they must agree: the loop
 * enforces it, and the panel shows progress against it. A panel with its own
 * copy would keep confidently naming a ceiling the runtime had moved.
 */
export const MAX_AGENT_OBSERVATIONS = 25

export const MAX_AGENT_FINDING_CHARS = 500

/**
 * The most a completion's evidence may quote. Short on purpose: it has to be
 * matched against the page, and a paragraph is a paraphrase no rendered page
 * will contain verbatim.
 */
export const MAX_AGENT_EVIDENCE_CHARS = 200

export const AgentDecisionSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("command"),
      command: AgentCommandSchema,
      finding: z.string().min(1).max(MAX_AGENT_FINDING_CHARS).optional()
    })
    .strict(),
  z
    .object({
      type: z.literal("ask_user"),
      question: z.string().min(1).max(2_000)
    })
    .strict(),
  /**
   * The goal is met. `evidence` is a short phrase the page shows now that
   * demonstrates it — a saved-state indicator, the new value, the record that
   * appeared. Required of a run that changed anything: pressing the right
   * button is an effect the verifier can confirm and says nothing about
   * whether the thing the user asked for is true. A run that only read is
   * asked for none; what it read is its answer.
   */
  z
    .object({
      type: z.literal("complete"),
      summary: z.string().min(1).max(20_000),
      evidence: z.string().min(1).max(MAX_AGENT_EVIDENCE_CHARS).optional()
    })
    .strict(),
  z
    .object({ type: z.literal("fail"), reason: z.string().min(1).max(2_000) })
    .strict()
])
export type AgentDecision = z.infer<typeof AgentDecisionSchema>

/**
 * The effect classes a user may pre-authorize for the rest of a run.
 *
 * Filling in three fields cost three prompts, which trains a user to approve
 * without reading — the failure mode a confirmation exists to prevent. These
 * two classes are the repetitive ones. Nothing that submits, destroys, pays,
 * authenticates or touches a sensitive control is grantable at any scope:
 * those are the prompts that have to keep meaning something.
 */
export const AGENT_GRANTABLE_EFFECTS = ["activation", "form_mutation"] as const
export const AgentGrantableEffectSchema = z.enum(AGENT_GRANTABLE_EFFECTS)
export type AgentGrantableEffect = z.infer<typeof AgentGrantableEffectSchema>

export const MAX_AGENT_GRANTS = 10

/** A grant names one origin and dies with the run that was given it. */
export const AgentGrantSchema = z
  .object({
    origin: z.url(),
    effects: z.array(AgentGrantableEffectSchema).min(1).max(2),
    grantedAt: z.number().int().nonnegative()
  })
  .strict()
export type AgentGrant = z.infer<typeof AgentGrantSchema>

export const MAX_AGENT_QUESTION_CHARS = 2_000
export const MAX_AGENT_ANSWER_CHARS = 2_000
export const MAX_AGENT_ANSWERS = 10

/**
 * The model's open question. `ask_user` used to pause with reason `user`,
 * which is what a user pausing the run looks like: the question itself went
 * nowhere and there was nothing to answer it with.
 */
export const AgentQuestionSchema = z
  .object({
    id: z.string().min(1).max(200),
    text: z.string().min(1).max(MAX_AGENT_QUESTION_CHARS),
    askedAt: z.number().int().nonnegative()
  })
  .strict()
export type AgentQuestion = z.infer<typeof AgentQuestionSchema>

export const AgentAnswerSchema = z
  .object({
    questionId: z.string().min(1).max(200),
    question: z.string().max(MAX_AGENT_QUESTION_CHARS).optional(),
    text: z.string().min(1).max(MAX_AGENT_ANSWER_CHARS),
    answeredAt: z.number().int().nonnegative()
  })
  .strict()
export type AgentAnswer = z.infer<typeof AgentAnswerSchema>

export const AgentApprovalRequestSchema = z
  .object({
    id: z.string().min(1),
    runId: z.string().min(1),
    stepId: z.string().min(1),
    risk: z.enum(["medium", "high", "critical"]),
    action: z.string().min(1).max(500),
    consequence: z.string().min(1).max(1_000),
    pageEvidence: z.string().max(1_000).optional(),
    /**
     * The origin this effect happens on, and the classes the user may widen
     * to for the rest of the run. Absent means widening is not on offer —
     * which is how a critical effect, or one carrying an ungrantable class,
     * is kept to a single step: the panel cannot offer what it was not given.
     */
    origin: z.url().optional(),
    grantable: z.array(AgentGrantableEffectSchema).min(1).max(2).optional(),
    createdAt: z.number().int().nonnegative()
  })
  .strict()
  .refine(
    (request) =>
      request.grantable === undefined || request.origin !== undefined,
    "A grantable approval must name the origin it would be granted on"
  )
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
      "command_refused",
      "goal_failed",
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
    suspensionKind: z
      .enum(["approval", "takeover", "user", "question"])
      .optional()
  })
  .strict()
  .refine(
    (value) =>
      (value.suspendedAt === undefined) ===
      (value.suspensionKind === undefined),
    "A deadline suspension needs both its timestamp and kind"
  )
export type AgentDeadlineState = z.infer<typeof AgentDeadlineStateSchema>

/** A run holds a bounded allowlist, so growing it can be refused, never evicted. */
export const MAX_AGENT_ALLOWED_ORIGINS = 25

/**
 * Tabs a run may drive. The tab the user started on and every tab the run
 * opened itself are in scope; any other tab enters only through an approval
 * the user gave for that tab. Bounded like the origin allowlist, and for the
 * same reason: a full scope costs another prompt, never a silent adoption.
 */
export const MAX_AGENT_SCOPED_TABS = 25

export const AgentRunStateSchema = z
  .object({
    version: z.literal(1),
    id: z.string().min(1),
    goal: z.string().min(1).max(20_000),
    status: AgentRunStatusSchema,
    pauseReason: AgentPauseReasonSchema.optional(),
    stepCount: z.number().int().nonnegative().max(MAX_AGENT_OBSERVATIONS),
    observationCount: z.number().int().nonnegative(),
    controlledTabId: z.number().int().nonnegative(),
    providerId: z.string().min(1),
    modelId: z.string().min(1),
    allowedOrigins: z.array(z.string().min(1)).max(MAX_AGENT_ALLOWED_ORIGINS),
    /**
     * Tabs the run may act on. Absent on rows written before tab scope
     * existed, which means the controlled tab alone.
     */
    scopedTabIds: z
      .array(z.number().int().nonnegative())
      .max(MAX_AGENT_SCOPED_TABS)
      .optional(),
    /** Bounded model-authored outcome retained for completed-run display. */
    result: z.string().min(1).max(20_000).optional(),
    error: AgentErrorSchema.optional(),
    /** Pre-authorized effect classes, per origin, for this run only. */
    grants: z.array(AgentGrantSchema).max(MAX_AGENT_GRANTS).optional(),
    question: AgentQuestionSchema.optional(),
    answers: z.array(AgentAnswerSchema).max(MAX_AGENT_ANSWERS).optional(),
    deadline: AgentDeadlineStateSchema.optional(),
    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative()
  })
  .strict()
export type AgentRunState = z.infer<typeof AgentRunStateSchema>
