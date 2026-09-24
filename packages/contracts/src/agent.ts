import { z } from "zod"
import { AgentCommandSchema } from "./agent-command"

export const AGENT_RUN_STATUSES = [
  "submitted",
  /** Deciding what the goal asks for, before the first look at the page. */
  "planning",
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
  /**
   * Finished having done some of what was asked, and said so.
   *
   * Separate from `completed` because the panel reads a status before it
   * reads anything else, and a run that filled three fields of five is not
   * the same answer as one that filled all five. Folding it into `completed`
   * with a flag beside it would put the lie back in the place it started.
   */
  "partial",
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
 * Decisions a run may take before it is stopped.
 *
 * One observation is counted per decision, so this is the run's step ceiling
 * under an older name: the verification look that follows a step is free, and
 * the panel's progress bar is a step counter. Twenty-five of them was a
 * budget sized for a scripted model — a real task spends several steps
 * reading before it acts, and runs that were one click from finishing were
 * being stopped for arithmetic rather than for looping.
 *
 * Declared once because two places need it and they must agree: the loop
 * enforces it, and the panel shows progress against it. A panel with its own
 * copy would keep confidently naming a ceiling the runtime had moved.
 */
export const MAX_AGENT_OBSERVATIONS = 50

export const MAX_AGENT_FINDING_CHARS = 500

/**
 * The most a completion's evidence may quote. Short on purpose: it has to be
 * matched against the page, and a paragraph is a paraphrase no rendered page
 * will contain verbatim.
 */
export const MAX_AGENT_EVIDENCE_CHARS = 200

export const MAX_AGENT_REQUIREMENTS = 8
export const MAX_AGENT_REQUIREMENT_CHARS = 200
export const MAX_AGENT_REQUIREMENT_ID_CHARS = 8

export const AgentDecisionSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("command"),
      command: AgentCommandSchema,
      /** Planned outcome this command advances; binds later verification. */
      requirementId: z
        .string()
        .min(1)
        .max(MAX_AGENT_REQUIREMENT_ID_CHARS)
        .optional(),
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
      evidence: z.string().min(1).max(MAX_AGENT_EVIDENCE_CHARS).optional(),
      /**
       * One entry per planned requirement, by id, each answered separately.
       *
       * `met: false` is a legal answer and the honest one — it settles the
       * run as `partial` instead of sending it round the loop again. A run
       * that cannot finish something should be able to say so; the previous
       * shape gave it only "done" and "failed", which is how an ambiguity
       * became another click.
       */
      outcomes: z
        .array(
          z
            .object({
              id: z.string().min(1).max(MAX_AGENT_REQUIREMENT_ID_CHARS),
              met: z.boolean(),
              evidence: z
                .string()
                .min(1)
                .max(MAX_AGENT_EVIDENCE_CHARS)
                .optional()
            })
            .strict()
        )
        .max(MAX_AGENT_REQUIREMENTS)
        .optional()
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
 * are the repetitive classes.
 *
 * Submission is one of them. It was critical, and critical is never
 * grantable, so an agent asked to post ten comments had to ask a human for
 * the final click ten times, forever — a prompt nobody can ever answer once
 * is not a safeguard, it is a wall. It stays an approval by default and the
 * user may widen it to this origin for this run, which is the same bargain
 * every other repetitive class already offers.
 *
 * Nothing that destroys, pays, authenticates or touches a sensitive control
 * is grantable at any scope: those are the prompts that have to keep meaning
 * something.
 */
export const AGENT_GRANTABLE_EFFECTS = [
  "activation",
  "form_mutation",
  "submission"
] as const
export const AgentGrantableEffectSchema = z.enum(AGENT_GRANTABLE_EFFECTS)
export type AgentGrantableEffect = z.infer<typeof AgentGrantableEffectSchema>

/**
 * What the start screen's routine-actions checkbox pre-authorizes.
 *
 * Deliberately not the whole grantable set. A grant a user gives on a
 * specific approval is given while reading what that step would do;
 * this one is given before the run has started, against a checkbox, so it
 * covers only the repetitive classes the consent is worded for. A submission
 * is grantable — once the user has been shown one and said "always" — and is
 * never handed over in advance.
 */
export const AGENT_ROUTINE_GRANT_EFFECTS = [
  "activation",
  "form_mutation"
] as const satisfies readonly AgentGrantableEffect[]

export const MAX_AGENT_GRANTS = 10

/** A grant names one origin and dies with the run that was given it. */
export const AgentGrantSchema = z
  .object({
    origin: z.url(),
    effects: z
      .array(AgentGrantableEffectSchema)
      .min(1)
      .max(AGENT_GRANTABLE_EFFECTS.length),
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
/**
 * A sentence this build wrote for a person, carried as an i18n key and its
 * values rather than as English. The runtime has no translator — it is a
 * package — so it names the sentence and the panel says it in the user's
 * language. A value whose name ends in `Key` is itself a key, translated
 * before it is interpolated (a dialog's kind, say).
 *
 * The English text beside it stays: it is what a debug report, a test and a
 * record written before this field existed have to read.
 */
export const AgentDisplayTextSchema = z
  .object({
    key: z
      .string()
      .max(120)
      .regex(/^agent\.[a-z0-9_.]+$/),
    values: z
      .record(z.string().max(40), z.union([z.string().max(2_048), z.number()]))
      .optional()
  })
  .strict()
export type AgentDisplayText = z.infer<typeof AgentDisplayTextSchema>

/** A few sentences said in order: a prefix, the sentence, a caveat. */
const AgentDisplayTextListSchema = z.array(AgentDisplayTextSchema).min(1).max(4)

export const AgentQuestionSchema = z
  .object({
    id: z.string().min(1).max(200),
    text: z.string().min(1).max(MAX_AGENT_QUESTION_CHARS),
    /** Set when this build asked, not the model; the model's words are shown as they are. */
    display: AgentDisplayTextListSchema.optional(),
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
    display: z
      .object({
        action: AgentDisplayTextSchema,
        consequence: AgentDisplayTextListSchema
      })
      .strict()
      .optional(),
    pageEvidence: z.string().max(1_000).optional(),
    /**
     * The origin this effect happens on, and the classes the user may widen
     * to for the rest of the run. Absent means widening is not on offer —
     * which is how a critical effect, or one carrying an ungrantable class,
     * is kept to a single step: the panel cannot offer what it was not given.
     */
    origin: z.url().optional(),
    grantable: z
      .array(AgentGrantableEffectSchema)
      .min(1)
      .max(AGENT_GRANTABLE_EFFECTS.length)
      .optional(),
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
    display: AgentDisplayTextListSchema.optional(),
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
    /**
     * The i18n key of the failure the layer below already named, when there
     * is one. A provider that answered with its own typed failure — a wedged
     * local proxy replying 503, say — knows more about what went wrong than
     * the run does, and flattening that into "the model could not produce a
     * decision" sent a user to restart a provider that was running perfectly
     * well. The panel prefers this key over `agent.failure.<code>`; the code
     * still says which part of the run stopped.
     */
    messageKey: z.string().min(1).max(200).optional(),
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

/**
 * One outcome the goal asks for, fixed before the run takes its first look.
 *
 * The completion judge used to select the run's last applied mutation and
 * accept the whole task when that one step's verification confirmed the
 * step's own intended result. That proves an operation landed; it cannot
 * prove every requested outcome did. "Fill the form and submit it" is two
 * outcomes, and a run that submitted an empty form satisfied the check.
 *
 * Fixed before the first observation, and never rewritten, because a list the
 * run may edit is a list the run can shorten once it would rather stop. The
 * model proposes it from the goal alone — it has not seen the page yet, so it
 * cannot yet know which outcome will be inconvenient.
 */
export const AgentTaskRequirementSchema = z
  .object({
    id: z.string().min(1).max(MAX_AGENT_REQUIREMENT_ID_CHARS),
    /** The outcome in the model's words, one per entry, not a step to take. */
    text: z.string().min(1).max(MAX_AGENT_REQUIREMENT_CHARS),
    /**
     * `change` must end in a page state something can be quoted from.
     * `read` is answered by what the run read, and owes no page evidence —
     * asking a research goal to quote a saved-state indicator that does not
     * exist would refuse every one of them.
     */
    kind: z.enum(["change", "read"])
  })
  .strict()
export type AgentTaskRequirement = z.infer<typeof AgentTaskRequirementSchema>

/** What the planning call returns, before the run is allowed to look. */
export const AgentTaskPlanSchema = z
  .object({
    requirements: z
      .array(AgentTaskRequirementSchema)
      .min(1)
      .max(MAX_AGENT_REQUIREMENTS)
  })
  .strict()
export type AgentTaskPlan = z.infer<typeof AgentTaskPlanSchema>

/**
 * Which requirements a settled run could evidence, by id. Recorded on the run
 * so the panel and a later reader see the same answer the judge reached,
 * rather than re-deriving it from a summary the model wrote.
 */
export const AgentRunOutcomeSchema = z
  .object({
    met: z
      .array(z.string().min(1).max(MAX_AGENT_REQUIREMENT_ID_CHARS))
      .max(MAX_AGENT_REQUIREMENTS),
    unmet: z
      .array(z.string().min(1).max(MAX_AGENT_REQUIREMENT_ID_CHARS))
      .max(MAX_AGENT_REQUIREMENTS)
  })
  .strict()
export type AgentRunOutcome = z.infer<typeof AgentRunOutcomeSchema>

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

/**
 * How a follow-up run relates to the run it follows. `continue` takes the
 * next instruction on from where a settled run ended; `retry` sets the same
 * goal again after one that failed or was stopped. Starting over is neither:
 * it is a fresh run that carries nothing forward.
 */
export const AGENT_FOLLOW_UP_MODES = ["continue", "retry"] as const
export const AgentFollowUpModeSchema = z.enum(AGENT_FOLLOW_UP_MODES)
export type AgentFollowUpMode = z.infer<typeof AgentFollowUpModeSchema>

/**
 * The effects that cannot be taken back by doing them again.
 *
 * A second click on a tab or a second value in a field costs nothing; a
 * second submission posts the comment twice, a second payment pays twice, a
 * second delete removes the next row. These are the classes a follow-up must
 * never repeat on the strength of a model's reading of an earlier record.
 */
export const AGENT_CONSEQUENTIAL_EFFECTS = [
  "submission",
  "destructive",
  "payment",
  "download"
] as const
export const AgentConsequentialEffectSchema = z.enum(
  AGENT_CONSEQUENTIAL_EFFECTS
)
export type AgentConsequentialEffect = z.infer<
  typeof AgentConsequentialEffectSchema
>

/**
 * Consequential effects a follow-up can carry from the chain before it.
 *
 * A limit on what may be continued, never a window over what happened: a
 * chain that committed more than this is refused a follow-up rather than
 * handed a list with its oldest payment trimmed off. Sized so the list fits
 * a checkpoint and a small model's prompt beside everything else a step
 * carries; a run that submits or pays two dozen times is one to start over.
 */
export const MAX_AGENT_PRIOR_EFFECTS = 24
/**
 * How much of a page address a prior effect keeps. Shorter than a receipt's,
 * because the list rides every checkpoint of the follow-up and every prompt.
 */
export const MAX_AGENT_PRIOR_EFFECT_PAGE_CHARS = 300

/**
 * A consequential effect an earlier run in the chain already committed.
 *
 * Recorded so a follow-up cannot do it again: the controller refuses a
 * matching command before policy is asked, and the model is shown the list.
 * The target is the receipt's own bounded description; `page` is origin and
 * path, never a query or fragment, and absent when the receipt had none.
 * `effects` names which classes it was, and `form` where a submission or
 * payment was sent — the same form reached by a different command (a click
 * on the button, Enter in a field) is the same effect.
 */
export const AgentPriorEffectSchema = z
  .object({
    action: z.string().min(1).max(40),
    page: z.string().min(1).max(MAX_AGENT_PRIOR_EFFECT_PAGE_CHARS).optional(),
    effects: z
      .array(AgentConsequentialEffectSchema)
      .max(AGENT_CONSEQUENTIAL_EFFECTS.length)
      .optional(),
    form: z.string().min(1).max(MAX_AGENT_PRIOR_EFFECT_PAGE_CHARS).optional(),
    role: z.string().max(60).optional(),
    tag: z.string().max(40).optional(),
    name: z.string().max(120).optional()
  })
  .strict()
export type AgentPriorEffect = z.infer<typeof AgentPriorEffectSchema>

/**
 * The run a follow-up continues, as the follow-up's controller sees it.
 *
 * Held in the run state, unlike the chat linkage, because the controller has
 * to decide by it: the handoff is what the model is told happened, and the
 * effects are what it may not repeat. Written once at start and never
 * updated; the child plans and asks for approval afresh either way.
 */
export const AgentPreviousRunSchema = z
  .object({
    mode: AgentFollowUpModeSchema,
    handoff: AgentConversationHandoffSchema,
    effects: z.array(AgentPriorEffectSchema).max(MAX_AGENT_PRIOR_EFFECTS)
  })
  .strict()
export type AgentPreviousRun = z.infer<typeof AgentPreviousRunSchema>

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
    /**
     * What the goal asks for, fixed by the planning call. Optional because a
     * row written before planning existed carries none, and a host with no
     * planning port is judged the way it was before. A host that offers
     * planning never omits this after planning succeeds; a failed plan stops
     * before observation rather than weakening the completion gate.
     */
    requirements: z
      .array(AgentTaskRequirementSchema)
      .max(MAX_AGENT_REQUIREMENTS)
      .optional(),
    /** Which of them the settled run could evidence. */
    outcome: AgentRunOutcomeSchema.optional(),
    /** Bounded model-authored outcome retained for completed-run display. */
    result: z.string().min(1).max(20_000).optional(),
    error: AgentErrorSchema.optional(),
    /** Pre-authorized effect classes, per origin, for this run only. */
    grants: z.array(AgentGrantSchema).max(MAX_AGENT_GRANTS).optional(),
    question: AgentQuestionSchema.optional(),
    answers: z.array(AgentAnswerSchema).max(MAX_AGENT_ANSWERS).optional(),
    deadline: AgentDeadlineStateSchema.optional(),
    /** The settled run this one follows, when it was started as a follow-up. */
    previousRun: AgentPreviousRunSchema.optional(),
    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative()
  })
  .strict()
export type AgentRunState = z.infer<typeof AgentRunStateSchema>
