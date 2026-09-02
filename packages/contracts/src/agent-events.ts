import { z } from "zod"
import {
  AgentApprovalRequestSchema,
  AgentDecisionSchema,
  AgentErrorSchema,
  AgentPauseReasonSchema,
  AgentRunStatusSchema,
  AgentTakeoverRequestSchema
} from "./agent"

const EventBaseSchema = z.object({
  runId: z.string().min(1),
  at: z.number().int().nonnegative()
})

export const AgentEventSchema = z.discriminatedUnion("type", [
  EventBaseSchema.extend({
    type: z.literal("status_changed"),
    from: AgentRunStatusSchema,
    to: AgentRunStatusSchema
  }).strict(),
  EventBaseSchema.extend({
    type: z.literal("decision_received"),
    decision: AgentDecisionSchema
  }).strict(),
  EventBaseSchema.extend({
    type: z.literal("approval_requested"),
    request: AgentApprovalRequestSchema
  }).strict(),
  EventBaseSchema.extend({
    type: z.literal("takeover_requested"),
    request: AgentTakeoverRequestSchema
  }).strict(),
  EventBaseSchema.extend({
    type: z.literal("pause_requested"),
    reason: AgentPauseReasonSchema
  }).strict(),
  EventBaseSchema.extend({
    type: z.literal("failed"),
    error: AgentErrorSchema
  }).strict()
])
export type AgentEvent = z.infer<typeof AgentEventSchema>
