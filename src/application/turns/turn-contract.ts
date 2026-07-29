import { z } from "zod"
import {
  type DurableContextOptions,
  DurableContextOptionsSchema
} from "@/application/context/context-contract"
import type { ChatMessage } from "@/types"
import { ChatMessageSchema } from "@/types/chat.schemas"

export const TURN_MODES = [
  "new",
  "retry",
  "regenerate",
  "fork",
  "selection"
] as const

export const TurnModeSchema = z.enum(TURN_MODES)
export type TurnMode = z.infer<typeof TurnModeSchema>

export const TURN_STATUSES = [
  "submitted",
  "building-context",
  "generating",
  "completed",
  "failed",
  "cancelled"
] as const

export const TurnStatusSchema = z.enum(TURN_STATUSES)
export type TurnStatus = z.infer<typeof TurnStatusSchema>

export type TurnToast = {
  variant?: "default" | "destructive"
  titleKey: string
  descriptionKey?: string
  descriptionValues?: Record<string, string>
}

export const ContextReceiptSchema = z.object({
  version: z.literal(1),
  turnId: z.string().min(1),
  mode: TurnModeSchema,
  createdAt: z.number().int().nonnegative(),
  query: z.string(),
  model: z.object({
    id: z.string().min(1),
    providerId: z.string().min(1).optional()
  }),
  prompt: z.object({
    inputLength: z.number().int().nonnegative(),
    augmentedLength: z.number().int().nonnegative(),
    tabContextLength: z.number().int().nonnegative(),
    ragContextLength: z.number().int().nonnegative(),
    tabContextTruncated: z.boolean(),
    groundedOnlyMode: z.boolean(),
    insufficientContext: z.boolean()
  }),
  sources: z.array(
    z.object({
      id: z.union([z.string(), z.number()]),
      title: z.string(),
      excerpt: z.string(),
      score: z.number(),
      sectionPath: z.string().optional(),
      source: z.enum(["file", "memory", "tab", "unknown"]),
      chunkIndex: z.number().int().optional()
    })
  )
})

export type ContextReceipt = z.infer<typeof ContextReceiptSchema>

export const PersistedTurnRequestSchema = z.object({
  version: z.literal(1),
  context: DurableContextOptionsSchema,
  userMessage: ChatMessageSchema
})

export interface PersistedTurnRequest {
  version: 1
  context: DurableContextOptions
  userMessage: ChatMessage
}

export const parsePersistedTurnRequest = (
  value: unknown
): PersistedTurnRequest =>
  PersistedTurnRequestSchema.parse(value) as PersistedTurnRequest

export interface TurnSubmission {
  id: string
  sessionId: string
  mode: TurnMode
  model: string
  providerId?: string
  request: PersistedTurnRequest
  createdAt: number
}

export interface DurableTurnStart {
  submission: TurnSubmission
  userMessageId: number
}

export interface DurableTurnRun extends TurnSubmission {
  status: TurnStatus
  contextReceipt?: ContextReceipt
  userMessageId?: number
  assistantMessageId?: number
  failure?: string
  updatedAt: number
}
