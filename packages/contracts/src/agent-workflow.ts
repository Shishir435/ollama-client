import { z } from "zod"
import {
  MAX_AGENT_PLAN_ITEMS,
  MAX_AGENT_REQUIREMENT_ID_CHARS,
  MAX_AGENT_REQUIREMENT_ITEMS,
  MAX_AGENT_REQUIREMENTS
} from "./agent-task-limits"

/** At most eight single outcomes plus the plan's twenty-four named items. */
export const MAX_AGENT_WORKFLOW_ENTRIES =
  MAX_AGENT_REQUIREMENTS + MAX_AGENT_PLAN_ITEMS
export const MAX_AGENT_WORKFLOW_BYTES = 16_000
export const MAX_AGENT_WORKFLOW_EVIDENCE = 6

/** Runtime-derived continuity, never a model's declaration of completion. */
export const AgentWorkflowEntrySchema = z
  .object({
    requirementId: z.string().min(1).max(MAX_AGENT_REQUIREMENT_ID_CHARS),
    itemIndex: z
      .number()
      .int()
      .nonnegative()
      .max(MAX_AGENT_REQUIREMENT_ITEMS - 1)
      .optional(),
    status: z.enum([
      "pending",
      "supported",
      "verified",
      "effect_confirmed",
      "effect_uncertain",
      "needs_refresh",
      "blocked"
    ]),
    evidenceIds: z
      .array(z.string().min(1).max(240))
      .max(MAX_AGENT_WORKFLOW_EVIDENCE),
    /** An exact receipt reference; confirmation describes the effect, not the goal. */
    effect: z
      .object({
        sequence: z.number().int().positive(),
        settlement: z.enum(["confirmed", "unknown"])
      })
      .strict()
      .optional(),
    blocker: z
      .enum([
        "evidence_unavailable",
        "effect_unresolved",
        "step_refused",
        "step_failed",
        "history_unavailable"
      ])
      .optional()
  })
  .strict()
export type AgentWorkflowEntry = z.infer<typeof AgentWorkflowEntrySchema>

/** Phases select existing work; they never allocate a new run budget. */
export const AgentWorkflowSchema = z
  .object({
    version: z.literal(1),
    planVersion: z.number().int().positive(),
    throughSequence: z.number().int().nonnegative(),
    entries: z.array(AgentWorkflowEntrySchema).max(MAX_AGENT_WORKFLOW_ENTRIES),
    phase: z
      .object({
        index: z.number().int().nonnegative().max(MAX_AGENT_WORKFLOW_ENTRIES),
        total: z.number().int().nonnegative().max(MAX_AGENT_WORKFLOW_ENTRIES),
        kind: z.enum(["read", "act", "verify", "reconcile", "review"])
      })
      .strict()
  })
  .strict()
  .superRefine((workflow, context) => {
    const identities = workflow.entries.map(
      (entry) => `${entry.requirementId}:${entry.itemIndex ?? "whole"}`
    )
    if (
      new Set(identities).size !== identities.length ||
      workflow.phase.total !== workflow.entries.length ||
      workflow.phase.index > workflow.phase.total ||
      JSON.stringify(workflow).length * 3 > MAX_AGENT_WORKFLOW_BYTES
    )
      context.addIssue({
        code: "custom",
        message: "Workflow progress exceeds its bounds or repeats an identity"
      })
  })
export type AgentWorkflow = z.infer<typeof AgentWorkflowSchema>
