import { z } from "zod"
import { AgentCommandSchema } from "./agent-command"
import { AgentCompletionCheckSchema } from "./agent-completion-check"
import {
  AgentEvidenceLedgerSchema,
  AgentSourceQuotesSchema,
  MAX_AGENT_LEDGER_BYTES
} from "./agent-evidence"
import {
  MAX_AGENT_CONSTRAINTS,
  MAX_AGENT_PLAN_AMENDMENTS,
  MAX_AGENT_PLAN_ITEMS,
  MAX_AGENT_PLAN_LIMITATION_CHARS,
  MAX_AGENT_REQUIREMENT_CHARS,
  MAX_AGENT_REQUIREMENT_ID_CHARS,
  MAX_AGENT_REQUIREMENT_ITEM_CHARS,
  MAX_AGENT_REQUIREMENT_ITEMS,
  MAX_AGENT_REQUIREMENT_SOURCE_CHARS,
  MAX_AGENT_REQUIREMENTS
} from "./agent-task-limits"
import { AgentWorkflowSchema } from "./agent-workflow"

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
  "worker_lost",
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
 * The most of a decision's reasoning a step keeps for the work log.
 *
 * Hosted models stream their thinking, and a supervisor watching a run wants
 * to know why it is about to click something. It is display text for the
 * card, never replayed to a model and never an instruction; bounded because
 * it rides a receipt whose whole size is capped, and the end is kept because
 * that is where a model states what it decided.
 */
export const MAX_AGENT_THINKING_CHARS = 1_500

/** The end of a decision's reasoning, bounded, marked where it was cut. */
export const agentThinkingTail = (text: string): string | undefined => {
  const trimmed = text.trim()
  if (!trimmed) return undefined
  return trimmed.length <= MAX_AGENT_THINKING_CHARS
    ? trimmed
    : `…${trimmed.slice(-(MAX_AGENT_THINKING_CHARS - 1)).trimStart()}`
}

/** The row text kept beside a step's target, as the observation bounds it. */
export const MAX_AGENT_ROW_CONTEXT_CHARS = 140

/**
 * The most a completion's evidence may quote. Short on purpose: it has to be
 * matched against the page, and a paragraph is a paraphrase no rendered page
 * will contain verbatim.
 */
export const MAX_AGENT_EVIDENCE_CHARS = 200

export {
  MAX_AGENT_CONSTRAINTS,
  MAX_AGENT_PLAN_AMENDMENTS,
  MAX_AGENT_PLAN_ITEMS,
  MAX_AGENT_PLAN_LIMITATION_CHARS,
  MAX_AGENT_REQUIREMENT_CHARS,
  MAX_AGENT_REQUIREMENT_ID_CHARS,
  MAX_AGENT_REQUIREMENT_ITEM_CHARS,
  MAX_AGENT_REQUIREMENT_ITEMS,
  MAX_AGENT_REQUIREMENT_SOURCE_CHARS,
  MAX_AGENT_REQUIREMENTS
} from "./agent-task-limits"

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
      finding: z.string().min(1).max(MAX_AGENT_FINDING_CHARS).optional(),
      sourceQuotes: AgentSourceQuotesSchema.optional()
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
      sourceQuotes: AgentSourceQuotesSchema.optional(),
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
                .optional(),
              /**
               * One answer per item of an itemized requirement, by its
               * position. A requirement covering nine invoices is met only
               * when all nine are, each judged on its own evidence — one
               * quotation for one invoice says nothing about the other eight.
               */
              items: z
                .array(
                  z
                    .object({
                      index: z
                        .number()
                        .int()
                        .nonnegative()
                        .max(MAX_AGENT_REQUIREMENT_ITEMS - 1),
                      met: z.boolean(),
                      evidence: z
                        .string()
                        .min(1)
                        .max(MAX_AGENT_EVIDENCE_CHARS)
                        .optional()
                    })
                    .strict()
                )
                .max(MAX_AGENT_REQUIREMENT_ITEMS)
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
 * is grantable once the user has been shown one and said "always", and is
 * never handed over from this setting alone; the start prompt's narrower
 * search consent is `AgentGrant.searches`.
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
    grantedAt: z.number().int().nonnegative(),
    /**
     * Searches on this origin run without asking: a GET submission from a form
     * the page marks as a search with nothing to fill in but the query
     * (`AgentElement.searchForm`). Given only by a start prompt that said so,
     * for the starting origin. A POST, a form with settings or a second field,
     * and a sensitive form are not searches and still ask.
     */
    searches: z.literal(true).optional()
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
    /**
     * A site this navigation opens that the run's routine consent will cover
     * once approved — clicks and typing, never submissions. Set only when the
     * run was given routine consent, and said in the consequence the user
     * approves, so approving the site is approving that too.
     */
    routineOrigin: z.url().optional(),
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

/**
 * What stopped the run making headway, as recovery records it. A closed
 * vocabulary of this build's own facts, never page text.
 */
export const AGENT_RECOVERY_TRIGGERS = [
  /** The same decision on the same page, the no-progress guard's count. */
  "no_progress",
  /** The resolver refused consecutive commands. */
  "refused_commands",
  /**
   * The same completion claimed again after it was refused. The run believes
   * it is done, so the only strategy that can help is reading what would
   * prove it; waiting, pictures and other routes cannot.
   */
  "refused_completion",
  /** A command named a snapshot the page has already moved past. */
  "stale_snapshot",
  /**
   * An applied effect whose verification could not say whether it landed.
   * Recovery may only gather evidence about it: read the page again and ask
   * the verifier again. It never applies the effect a second time.
   */
  "unresolved_effect"
] as const
export const AgentRecoveryTriggerSchema = z.enum(AGENT_RECOVERY_TRIGGERS)
export type AgentRecoveryTrigger = z.infer<typeof AgentRecoveryTriggerSchema>

/**
 * The whole set of things a run may try before it spends the user's
 * attention. Each one is guidance for the next decision or a fresh read; none
 * is an action of its own, so every command a recovery leads to goes through
 * the same resolver, policy, persistence, executor and verifier as any other.
 */
export const AGENT_RECOVERY_STRATEGIES = [
  "fresh_observation",
  "targeted_read",
  "wait_for_condition",
  "request_vision",
  "alternate_route",
  "revise_approach"
] as const
export const AgentRecoveryStrategySchema = z.enum(AGENT_RECOVERY_STRATEGIES)
export type AgentRecoveryStrategy = z.infer<typeof AgentRecoveryStrategySchema>

/**
 * Strategies one run may spend, whatever triggered them. A run-wide ceiling
 * rather than a per-episode one: a page that alternates between two states
 * triggers afresh each time it settles, and only a budget that never refills
 * ends that loop.
 */
export const MAX_AGENT_RECOVERY_ATTEMPTS = 6

/**
 * Durable recovery accounting. In the checkpoint, not in the controller's
 * memory, so a worker restart cannot hand a looping run a fresh budget.
 *
 * `attempts` only ever grows. `active` is the episode in progress — its
 * trigger, the strategy the next decision is told to use, the ones already
 * tried — and is cleared once a page-changing step verifies, which is the
 * run back on ground it can trust. `evidenceStep` names the last verified
 * step, so the model is pointed at what still holds rather than at the step
 * that went wrong.
 */
export const AgentRecoveryStateSchema = z
  .object({
    attempts: z.number().int().nonnegative().max(MAX_AGENT_RECOVERY_ATTEMPTS),
    active: z
      .object({
        trigger: AgentRecoveryTriggerSchema,
        strategy: AgentRecoveryStrategySchema,
        tried: z
          .array(AgentRecoveryStrategySchema)
          .min(1)
          .max(AGENT_RECOVERY_STRATEGIES.length),
        startedAt: z.number().int().nonnegative(),
        /** The run's history entry for its last verified step, if any. */
        evidenceStep: z
          .number()
          .int()
          .positive()
          .max(MAX_AGENT_OBSERVATIONS + 5)
          .optional()
      })
      .strict()
      .optional()
  })
  .strict()
export type AgentRecoveryState = z.infer<typeof AgentRecoveryStateSchema>

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
     * `change` requires observable state or exact verified receipt facts.
     * `read` requires independent source support retained in the ledger.
     */
    kind: z.enum(["change", "read"]),
    check: AgentCompletionCheckSchema.optional(),
    /**
     * The words of the goal — or of a user's answer — this outcome answers,
     * quoted. Checked against them when the plan is parsed, so an outcome
     * nobody asked for cannot enter the plan dressed as one somebody did.
     * Absent on rows planned before it existed, and when a model quoted
     * nothing: the outcome is kept, untraced, rather than costing the run its
     * plan.
     */
    source: z
      .string()
      .min(1)
      .max(MAX_AGENT_REQUIREMENT_SOURCE_CHARS)
      .optional(),
    /**
     * The repeated things one outcome covers — rows, recipients, files —
     * named rather than each becoming a top-level requirement. Nine rows to
     * update is one outcome with nine items, not nine outcomes the cap would
     * have to cut.
     */
    items: z
      .array(z.string().min(1).max(MAX_AGENT_REQUIREMENT_ITEM_CHARS))
      .min(1)
      .max(MAX_AGENT_REQUIREMENT_ITEMS)
      .optional(),
    /** The plan version that introduced it; absent means the first. */
    since: z.number().int().min(1).optional()
  })
  .strict()
export type AgentTaskRequirement = z.infer<typeof AgentTaskRequirementSchema>

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
      .max(MAX_AGENT_REQUIREMENTS),
    /**
     * The met reads whose only support was a screenshot: the model's reading
     * of a picture, not text the page said. Shown as such, never as verified.
     */
    visual: z
      .array(z.string().min(1).max(MAX_AGENT_REQUIREMENT_ID_CHARS))
      .max(MAX_AGENT_REQUIREMENTS)
      .optional()
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
  MAX_AGENT_HANDOFF_FINDINGS * MAX_AGENT_FINDING_CHARS +
  MAX_AGENT_LEDGER_BYTES

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
        total: z.number().int().nonnegative(),
        /** Of the met, how many were only seen in a screenshot. */
        visual: z.number().int().positive().optional()
      })
      .strict()
      .optional(),
    failure: AgentErrorSchema.shape.code.optional(),
    findings: z
      .array(z.string().min(1).max(MAX_AGENT_FINDING_CHARS))
      .max(MAX_AGENT_HANDOFF_FINDINGS),
    evidenceLedger: AgentEvidenceLedgerSchema.optional(),
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
 * What the goal says must not happen, kept apart from what it asks for.
 *
 * "Fill the form but don't submit it" planned as two outcomes asked the run
 * to evidence a non-event, and a plan with only outcomes had nowhere to keep
 * "only these two rows" or "under $50" at all — the boundary was in the goal
 * and nowhere the run checked. `exclude` is a thing not to do, `scope` names
 * what may be touched and implies nothing else is, `limit` is a bound a value
 * must stay within.
 *
 * `forbids` is the part a controller can enforce without reading prose: the
 * consequential effect classes the constraint rules out. A command whose
 * resolved effect carries one is refused before policy is asked. The text
 * stays for the decision model and the user; the classes are what binds.
 */
export const AGENT_CONSTRAINT_KINDS = ["exclude", "scope", "limit"] as const
export const AgentTaskConstraintSchema = z
  .object({
    id: z.string().min(1).max(MAX_AGENT_REQUIREMENT_ID_CHARS),
    text: z.string().min(1).max(MAX_AGENT_REQUIREMENT_CHARS),
    kind: z.enum(AGENT_CONSTRAINT_KINDS),
    forbids: z
      .array(AgentConsequentialEffectSchema)
      .min(1)
      .max(AGENT_CONSEQUENTIAL_EFFECTS.length)
      .optional(),
    source: z
      .string()
      .min(1)
      .max(MAX_AGENT_REQUIREMENT_SOURCE_CHARS)
      .optional(),
    since: z.number().int().min(1).optional()
  })
  .strict()
export type AgentTaskConstraint = z.infer<typeof AgentTaskConstraintSchema>

/**
 * One thing a planner proposes to take out of the plan: a whole entry, or
 * one item of an itemized requirement. Never applied on the planner's word —
 * the run asks the user, and only a plain yes removes it.
 */
export const AgentPlanRemovalSchema = z
  .object({
    id: z.string().min(1).max(MAX_AGENT_REQUIREMENT_ID_CHARS),
    item: z.string().min(1).max(MAX_AGENT_REQUIREMENT_ITEM_CHARS).optional()
  })
  .strict()
export type AgentPlanRemoval = z.infer<typeof AgentPlanRemovalSchema>
export const MAX_AGENT_PLAN_REMOVALS =
  MAX_AGENT_REQUIREMENTS + MAX_AGENT_CONSTRAINTS

/** The plan bounds a goal can outgrow. */
export const AGENT_PLAN_OVER_CAP_UNITS = [
  "outcomes",
  "items",
  "constraints"
] as const
export type AgentPlanOverCapUnit = (typeof AGENT_PLAN_OVER_CAP_UNITS)[number]

/**
 * What the planning call returns, before the run is allowed to look.
 *
 * Exactly one answer: a plan, a question the goal leaves open, a limitation
 * that rules the task out, or the count of outcomes a goal asked for when it
 * was more than one run tracks. The last three are said before anything
 * happens to a page, which is the only time saying them costs nothing.
 */
export const AgentTaskPlanSchema = z
  .object({
    requirements: z
      .array(AgentTaskRequirementSchema)
      .max(MAX_AGENT_REQUIREMENTS),
    constraints: z
      .array(AgentTaskConstraintSchema)
      .max(MAX_AGENT_CONSTRAINTS)
      .optional(),
    clarification: z.string().min(1).max(MAX_AGENT_QUESTION_CHARS).optional(),
    limitation: z
      .string()
      .min(1)
      .max(MAX_AGENT_PLAN_LIMITATION_CHARS)
      .optional(),
    /**
     * Which bound the goal outgrew, by how much, and what the bound is: the
     * question it becomes has to name the limit that actually stopped the
     * plan, not call thirteen rows thirteen outcomes.
     */
    overCap: z
      .object({
        unit: z.enum(AGENT_PLAN_OVER_CAP_UNITS),
        requested: z.number().int().positive(),
        max: z.number().int().positive()
      })
      .strict()
      .optional(),
    /**
     * Made by rule because the planner could not be reached. It carries the
     * limits the user's newest words set, which a rule can read, and not the
     * outcomes they may have added, which it cannot — so the answer it came
     * from is not counted as absorbed.
     */
    provisional: z.literal(true).optional(),
    /**
     * What an amendment would take out, for the user to confirm. A removal
     * the planner could apply itself is a removal a misread answer could
     * apply, and every reading rule tried for that was one phrasing short.
     */
    proposedRemovals: z
      .array(AgentPlanRemovalSchema)
      .min(1)
      .max(MAX_AGENT_PLAN_REMOVALS)
      .optional()
  })
  .strict()
  .refine(
    (plan) =>
      [
        plan.requirements.length > 0,
        plan.clarification !== undefined,
        plan.limitation !== undefined,
        plan.overCap !== undefined
      ].filter(Boolean).length === 1,
    "A plan is exactly one of: requirements, a clarification, a limitation, or an over-cap count"
  )
  .refine(
    (plan) =>
      plan.requirements.reduce(
        (total, requirement) => total + (requirement.items?.length ?? 0),
        0
      ) <= MAX_AGENT_PLAN_ITEMS,
    "A plan enumerates at most MAX_AGENT_PLAN_ITEMS items"
  )
export type AgentTaskPlan = z.infer<typeof AgentTaskPlanSchema>

/**
 * One change the user's own words made to the plan after it was fixed.
 *
 * Only an answer the user typed amends a plan — never page text, a finding,
 * or a recovery decision — so each amendment names the answer it came from.
 * The ids it added and removed are recorded so a reader can reconstruct
 * every version without the plan being stored once per version.
 */
export const AgentPlanAmendmentSchema = z
  .object({
    version: z.number().int().min(2),
    answeredAt: z.number().int().nonnegative(),
    added: z
      .array(z.string().min(1).max(MAX_AGENT_REQUIREMENT_ID_CHARS))
      .max(MAX_AGENT_REQUIREMENTS + MAX_AGENT_CONSTRAINTS),
    removed: z
      .array(z.string().min(1).max(MAX_AGENT_REQUIREMENT_ID_CHARS))
      .max(MAX_AGENT_REQUIREMENTS + MAX_AGENT_CONSTRAINTS),
    /** Items the user confirmed removing from a requirement that stayed. */
    removedItems: z
      .array(AgentPlanRemovalSchema.required({ item: true }))
      .max(MAX_AGENT_PLAN_ITEMS)
      .optional(),
    at: z.number().int().nonnegative()
  })
  .strict()
export type AgentPlanAmendment = z.infer<typeof AgentPlanAmendmentSchema>

/**
 * The bookkeeping that keeps a plan's ids stable across its versions.
 *
 * `issued` is the highest number ever stamped on a requirement and on a
 * constraint, so an id a user's amendment removed is never handed to a
 * different outcome later — a receipt bound to `r3` must keep meaning the
 * `r3` it was bound to. `reconciledThrough` is the newest user answer the
 * plan has been checked against; an answer newer than it is what prompts
 * the next amendment.
 */
export const AgentPlanRecordSchema = z
  .object({
    version: z.number().int().min(1),
    issued: z
      .object({
        requirements: z.number().int().nonnegative(),
        constraints: z.number().int().nonnegative()
      })
      .strict(),
    reconciledThrough: z.number().int().nonnegative().optional(),
    amendments: z
      .array(AgentPlanAmendmentSchema)
      .max(MAX_AGENT_PLAN_AMENDMENTS)
      .optional(),
    /**
     * Removals the planner proposed and the user has been asked about. Held
     * here, with the question that asks, so the answer to that question —
     * and no other — decides them.
     */
    pending: z
      .object({
        questionId: z.string().min(1).max(200),
        removals: z
          .array(AgentPlanRemovalSchema)
          .min(1)
          .max(MAX_AGENT_PLAN_REMOVALS),
        /**
         * Set when the removals lift prohibitions. Asked on its own, by the
         * effect it would allow, and answered only by "allow": a "yes" to
         * "no longer needs: don't submit" reads just as well as "yes, don't".
         */
        lift: z.literal(true).optional(),
        /** Removal frees capacity; the original added work still needs planning. */
        provisional: z.literal(true).optional()
      })
      .strict()
      .optional()
  })
  .strict()
export type AgentPlanRecord = z.infer<typeof AgentPlanRecordSchema>

/**
 * A requirement of the run a follow-up continues, with whether it was met.
 *
 * Carried so the follow-up's plan can keep the same id for the same outcome:
 * "retry" reasks the same goal, and an `r2` that meant the submission in the
 * first run and the second field in the retry would make two records
 * disagree about one task.
 */
export const AgentPreviousRequirementSchema = z
  .object({
    id: z.string().min(1).max(MAX_AGENT_REQUIREMENT_ID_CHARS),
    text: z.string().min(1).max(MAX_AGENT_REQUIREMENT_CHARS),
    kind: z.enum(["change", "read"]),
    check: AgentCompletionCheckSchema.optional(),
    met: z.boolean().optional()
  })
  .strict()
export type AgentPreviousRequirement = z.infer<
  typeof AgentPreviousRequirementSchema
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
    effects: z.array(AgentPriorEffectSchema).max(MAX_AGENT_PRIOR_EFFECTS),
    /** Absent when the earlier run was never planned. */
    requirements: z
      .array(AgentPreviousRequirementSchema)
      .max(MAX_AGENT_REQUIREMENTS)
      .optional(),
    /**
     * The earlier run's prohibitions — constraints that forbid an effect.
     * A follow-up's goal is often the chat model's words, not the user's, so
     * a "don't submit" said to the first run must not end with it.
     */
    constraints: z
      .array(AgentTaskConstraintSchema)
      .max(MAX_AGENT_CONSTRAINTS)
      .optional()
  })
  .strict()
export type AgentPreviousRun = z.infer<typeof AgentPreviousRunSchema>

/**
 * A goal the chat model wrote: `model` from a turn that had read nothing off a
 * page, `model_after_page` from one that had.
 */
export const AgentGoalAuthorSchema = z.enum(["model", "model_after_page"])
export type AgentGoalAuthor = z.infer<typeof AgentGoalAuthorSchema>

export const AgentPendingSupervisionSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("approval"),
      request: AgentApprovalRequestSchema
    })
    .strict(),
  z
    .object({
      kind: z.literal("takeover"),
      request: AgentTakeoverRequestSchema
    })
    .strict()
])
export type AgentPendingSupervisionRecord = z.infer<
  typeof AgentPendingSupervisionSchema
>

export const AgentRunStateSchema = z
  .object({
    version: z.literal(1),
    id: z.string().min(1),
    goal: z.string().min(1).max(20_000),
    status: AgentRunStatusSchema,
    pauseReason: AgentPauseReasonSchema.optional(),
    /** Retains an unanswered human request over worker loss; it never authorizes replay. */
    humanDecision: AgentPendingSupervisionSchema.optional(),
    /** Explicit user consent for this run, bounded to the scope shown when enabled. */
    unattended: z
      .object({
        approvedAt: z.number().int().nonnegative(),
        browserSessionId: z.string().min(1).max(100),
        origins: z.array(z.string().min(1)).max(MAX_AGENT_ALLOWED_ORIGINS),
        tabIds: z
          .array(z.number().int().nonnegative())
          .max(MAX_AGENT_SCOPED_TABS),
        providerId: z.string().min(1),
        modelId: z.string().min(1)
      })
      .strict()
      .optional(),
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
    /**
     * What the goal says must not happen. Written with the requirements and
     * amended with them; absent on rows planned before constraints existed.
     */
    constraints: z
      .array(AgentTaskConstraintSchema)
      .max(MAX_AGENT_CONSTRAINTS)
      .optional(),
    /** Version and id bookkeeping for `requirements` and `constraints`. */
    plan: AgentPlanRecordSchema.optional(),
    /** Which of them the settled run could evidence. */
    outcome: AgentRunOutcomeSchema.optional(),
    /** Source quotations captured with the terminal answer, committed with it. */
    evidenceLedger: AgentEvidenceLedgerSchema.optional(),
    /** Optional for checkpoints predating durable workflow progress. Rebuilt from receipts. */
    workflow: AgentWorkflowSchema.optional(),
    /** Bounded model-authored outcome retained for completed-run display. */
    result: z.string().min(1).max(20_000).optional(),
    error: AgentErrorSchema.optional(),
    /** Pre-authorized effect classes, per origin, for this run only. */
    grants: z.array(AgentGrantSchema).max(MAX_AGENT_GRANTS).optional(),
    question: AgentQuestionSchema.optional(),
    answers: z.array(AgentAnswerSchema).max(MAX_AGENT_ANSWERS).optional(),
    deadline: AgentDeadlineStateSchema.optional(),
    /** Absent on rows written before recovery existed, and on runs that never needed it. */
    recovery: AgentRecoveryStateSchema.optional(),
    /** The settled run this one follows, when it was started as a follow-up. */
    previousRun: AgentPreviousRunSchema.optional(),
    /**
     * Who wrote the goal, when it was not the user. Absent means the user
     * typed it. A chat model that delegates a task writes it itself, and one
     * that had read page content in the same turn may be repeating what a page
     * told it to say — so that goal is not counted as the user's own words by
     * the egress rule.
     */
    goalAuthor: AgentGoalAuthorSchema.optional(),
    /**
     * The chat tool call that delegated the run. A call replayed after a worker
     * restart names the same id and finds this run; any other call from the
     * same turn is a second task, not a replay.
     */
    toolCallId: z.string().min(1).max(200).optional(),
    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative()
  })
  .strict()
export type AgentRunState = z.infer<typeof AgentRunStateSchema>
