import { z } from "zod"
import {
  ChatMessageMetricsSchema,
  ChatMessageSchema,
  ToolCallSchema,
  ToolRunSchema
} from "./chat"

export const TOOL_LOOP_MODES = [
  "native",
  "native-user-results",
  "non-native"
] as const
export const ToolLoopModeSchema = z.enum(TOOL_LOOP_MODES)
export type ToolLoopMode = z.infer<typeof ToolLoopModeSchema>

export const TOOL_LOOP_RUN_STATUSES = [
  "running",
  "awaiting-confirmation"
] as const
export const ToolLoopRunStatusSchema = z.enum(TOOL_LOOP_RUN_STATUSES)
export type ToolLoopRunStatus = z.infer<typeof ToolLoopRunStatusSchema>

/** Durable state shared by native and prompt-based tool loops. */
export const DurableToolLoopStateSchema = z.object({
  iteration: z.number().int().nonnegative(),
  phase: z.enum(["model", "tools"]),
  taintGeneration: z.number().int().nonnegative().optional(),
  workingMessages: z.array(ChatMessageSchema),
  toolRuns: z.array(ToolRunSchema),
  pendingToolCalls: z.array(ToolCallSchema).optional(),
  nextToolIndex: z.number().int().nonnegative().optional(),
  toolResultMessages: z.array(ChatMessageSchema).optional(),
  imageMessages: z.array(ChatMessageSchema).optional(),
  nonNativeResponseParts: z.array(z.string()).optional(),
  lastMetrics: ChatMessageMetricsSchema.optional(),
  emptyModelRetries: z.number().int().nonnegative().optional()
})

export type DurableToolLoopStateParsed = z.infer<
  typeof DurableToolLoopStateSchema
>

export const ToolLoopCheckpointEnvelopeSchema = z.object({
  version: z.literal(1),
  state: DurableToolLoopStateSchema
})

export type ToolLoopCheckpointEnvelope = z.infer<
  typeof ToolLoopCheckpointEnvelopeSchema
>
