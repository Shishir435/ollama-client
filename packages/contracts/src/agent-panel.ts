import { z } from "zod"
import {
  AgentApprovalRequestSchema,
  AgentRunStateSchema,
  AgentStepStatusSchema,
  AgentTakeoverRequestSchema,
  MAX_AGENT_ANSWER_CHARS
} from "./agent"
import { AgentCommandSchema } from "./agent-command"

export const AGENT_PANEL_PROTOCOL_VERSION = 1 as const

export const AgentRiskSchema = z.enum(["low", "medium", "high", "critical"])

export const AgentVerificationRecordSchema = z
  .object({
    outcome: z.enum(["confirmed", "negative", "ambiguous"]),
    evidence: z
      .object({
        kind: z.string().min(1).max(120),
        summary: z.string().min(1).max(1_000),
        observedAt: z.number().int().nonnegative()
      })
      .strict()
  })
  .strict()

/**
 * One durable step as the panel receives it. Sensitive command values are
 * already redacted where the step was written, so nothing here needs to be
 * hidden again at render time.
 */
export const AgentStepRecordSchema = z
  .object({
    runId: z.string().min(1),
    stepId: z.string().min(1),
    sequence: z.number().int().nonnegative(),
    status: AgentStepStatusSchema,
    at: z.number().int().nonnegative(),
    command: AgentCommandSchema.optional(),
    risk: AgentRiskSchema.optional(),
    verification: AgentVerificationRecordSchema.optional(),
    /**
     * What the step acted on, in terms that outlive the snapshot its ref came
     * from. The name is page text: already dropped where the receipt was
     * written when the control was sensitive, and bounded either way.
     */
    target: z
      .object({
        ref: z.string().max(40).optional(),
        tag: z.string().max(40).optional(),
        role: z.string().max(60).optional(),
        name: z.string().max(120).optional()
      })
      .strict()
      .optional(),
    sourceUrl: z.string().max(2_048).optional(),
    finding: z.string().max(500).optional()
  })
  .strict()
export type AgentStepRecord = z.infer<typeof AgentStepRecordSchema>

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

/** Which endpoint answers the run, disclosed to the user before it starts. */
export const AgentProviderDisclosureSchema = z
  .object({
    name: z.string().min(1).max(200),
    model: z.string().min(1).max(200),
    location: z.enum(["local", "remote"]),
    /**
     * Whether viewport screenshots will travel with observations: true for a
     * model that reads images. Absent when it could not be determined, which
     * the panel shows as unknown rather than as "no".
     */
    screenshots: z.boolean().optional()
  })
  .strict()

/**
 * What this browser lets a run do, disclosed before it starts.
 *
 * A user cannot supervise what they were not told about. Chromium shows its
 * own "is debugging this browser" banner the moment the run attaches, and a
 * banner with no explanation beside it is the thing that sends someone to ask
 * a developer. Firefox has no debugger at all, so the same run is quietly a
 * different one: no native input, no pictures, no native dialogs — limits
 * worth knowing before a task is set rather than after it stalls.
 */
export const AgentBrowserDisclosureSchema = z
  .object({
    /** `cdp` attaches the debugger; `dom` drives the page through content scripts. */
    backend: z.enum(["cdp", "dom"]),
    /** Whether the run will attach a debugger, and the browser will say so. */
    attaches: z.boolean(),
    nativeInput: z.boolean(),
    screenshots: z.boolean(),
    /** Native alert/confirm/prompt can only be seen through a debugger. */
    dialogs: z.boolean()
  })
  .strict()
export type AgentBrowserDisclosure = z.infer<
  typeof AgentBrowserDisclosureSchema
>

export const AgentPanelSnapshotSchema = z
  .object({
    run: AgentRunStateSchema.optional(),
    // Each of 25 actions has up to five append-only lifecycle receipts.
    steps: z.array(AgentStepRecordSchema).max(125),
    pending: AgentPendingSupervisionSchema.optional(),
    provider: AgentProviderDisclosureSchema.optional(),
    browser: AgentBrowserDisclosureSchema.optional(),
    tab: z
      .object({
        title: z.string().max(500),
        url: z.string().max(2_048)
      })
      .strict()
      .optional()
  })
  .strict()
export type AgentPanelSnapshot = z.infer<typeof AgentPanelSnapshotSchema>

const RunScopedSchema = z.object({ runId: z.string().min(1) })
const AnswerSchema = RunScopedSchema.extend({
  requestId: z.string().min(1)
})

/**
 * Panel to background. Every answer names the request it answers, so a click
 * on a stale panel cannot authorize whatever step replaced the one it saw.
 */
export const AgentPanelCommandSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("agent_start"),
      goal: z.string().min(1).max(20_000),
      tabId: z.number().int().nonnegative(),
      providerId: z.string().min(1),
      modelId: z.string().min(1),
      allowExperimentalModel: z.boolean().optional()
    })
    .strict(),
  RunScopedSchema.extend({ type: z.literal("agent_pause") }).strict(),
  RunScopedSchema.extend({
    type: z.literal("agent_resume"),
    text: z.string().min(1).max(MAX_AGENT_ANSWER_CHARS).optional(),
    pausedAt: z.number().int().nonnegative().optional()
  })
    .strict()
    .refine(
      (command) =>
        (command.text === undefined) === (command.pausedAt === undefined),
      { message: "A correction requires its pause timestamp" }
    ),
  RunScopedSchema.extend({ type: z.literal("agent_stop") }).strict(),
  RunScopedSchema.extend({
    type: z.literal("agent_complete_takeover")
  }).strict(),
  AnswerSchema.extend({
    type: z.literal("agent_approve"),
    /**
     * `run_origin` pre-authorizes the same class of effect on the same origin
     * for the rest of this run. Absent means this step only, which is what an
     * older panel sends and what every critical effect gets regardless.
     */
    scope: z.enum(["once", "run_origin"]).optional()
  }).strict(),
  AnswerSchema.extend({ type: z.literal("agent_reject") }).strict(),
  AnswerSchema.extend({ type: z.literal("agent_takeover_started") }).strict(),
  AnswerSchema.extend({ type: z.literal("agent_takeover_cancelled") }).strict(),
  AnswerSchema.extend({
    type: z.literal("agent_answer"),
    text: z.string().min(1).max(MAX_AGENT_ANSWER_CHARS)
  }).strict(),
  z
    .object({
      type: z.literal("agent_debug_report"),
      requestId: z.string().min(1).max(120),
      runId: z.string().min(1).max(200).optional()
    })
    .strict(),
  z.object({ type: z.literal("agent_refresh") }).strict()
])
export type AgentPanelCommand = z.infer<typeof AgentPanelCommandSchema>

/** Background to panel. */
export const AgentPanelMessageSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("agent_debug_report"),
      version: z.literal(AGENT_PANEL_PROTOCOL_VERSION),
      requestId: z.string().min(1).max(120),
      report: z.string().max(4_000_000)
    })
    .strict(),
  z
    .object({
      type: z.literal("agent_snapshot"),
      version: z.literal(AGENT_PANEL_PROTOCOL_VERSION),
      snapshot: AgentPanelSnapshotSchema
    })
    .strict(),
  z
    .object({
      type: z.literal("agent_command_failed"),
      version: z.literal(AGENT_PANEL_PROTOCOL_VERSION),
      command: z.string().min(1).max(120),
      messageKey: z.string().min(1).max(200),
      message: z.string().min(1).max(1_000),
      /**
       * Only for a failure the background could not classify: the error's own
       * name and message, so a Preview user can report what actually broke
       * instead of "something went wrong". A classified refusal carries none.
       */
      detail: z.string().max(300).optional()
    })
    .strict()
])
export type AgentPanelMessage = z.infer<typeof AgentPanelMessageSchema>
