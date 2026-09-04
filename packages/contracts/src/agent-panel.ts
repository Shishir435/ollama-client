import { z } from "zod"
import {
  AgentApprovalRequestSchema,
  AgentRunStateSchema,
  AgentStepStatusSchema,
  AgentTakeoverRequestSchema
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
    verification: AgentVerificationRecordSchema.optional()
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
    location: z.enum(["local", "remote"])
  })
  .strict()

export const AgentPanelSnapshotSchema = z
  .object({
    run: AgentRunStateSchema.optional(),
    steps: z.array(AgentStepRecordSchema).max(25),
    pending: AgentPendingSupervisionSchema.optional(),
    provider: AgentProviderDisclosureSchema.optional(),
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
  RunScopedSchema.extend({ type: z.literal("agent_resume") }).strict(),
  RunScopedSchema.extend({ type: z.literal("agent_stop") }).strict(),
  RunScopedSchema.extend({
    type: z.literal("agent_complete_takeover")
  }).strict(),
  AnswerSchema.extend({ type: z.literal("agent_approve") }).strict(),
  AnswerSchema.extend({ type: z.literal("agent_reject") }).strict(),
  AnswerSchema.extend({ type: z.literal("agent_takeover_started") }).strict(),
  AnswerSchema.extend({ type: z.literal("agent_takeover_cancelled") }).strict(),
  z.object({ type: z.literal("agent_refresh") }).strict()
])
export type AgentPanelCommand = z.infer<typeof AgentPanelCommandSchema>

/** Background to panel. */
export const AgentPanelMessageSchema = z.discriminatedUnion("type", [
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
      message: z.string().min(1).max(1_000)
    })
    .strict()
])
export type AgentPanelMessage = z.infer<typeof AgentPanelMessageSchema>
