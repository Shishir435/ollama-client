import { z } from "zod"
import { ChatMessageSchema } from "./chat"
import { DurableContextOptionsSchema } from "./context"

/** Stable user intent recorded with a durable turn. */
export const TURN_MODES = [
  "new",
  "retry",
  "regenerate",
  "fork",
  "selection"
] as const

export const TurnModeSchema = z.enum(TURN_MODES)
export type TurnMode = z.infer<typeof TurnModeSchema>

/**
 * Durable lifecycle states used for restart recovery.
 *
 * `cancelling` is committed intent, not an observation: it is written before
 * the in-memory controller is aborted, so a worker that dies between the two
 * still restarts knowing the user asked for a stop. Without it a stopped turn
 * came back as `generating` and recovery reissued the provider request.
 */
export const TURN_STATUSES = [
  "submitted",
  "building_context",
  "generating",
  "cancelling",
  "completed",
  "failed",
  "cancelled"
] as const

export const TurnStatusSchema = z.enum(TURN_STATUSES)
export type TurnStatus = z.infer<typeof TurnStatusSchema>

/** States a restart may resume. Cancellation intent is deliberately absent. */
export const RESUMABLE_TURN_STATUSES = [
  "submitted",
  "building_context",
  "generating"
] as const satisfies readonly TurnStatus[]

/**
 * States in which a durable turn still owns its assistant row.
 *
 * Deliberately wider than `RESUMABLE_TURN_STATUSES`: recovery must skip
 * `cancelling` — the user asked for a stop, so nothing may reissue it — while
 * ownership must include it, because the assistant of a turn that is still
 * settling has not been abandoned. Sweeping it would mark a response the user
 * deliberately stopped as interrupted and offer a retry for it.
 */
export const TURN_OWNED_ASSISTANT_STATUSES = [
  ...RESUMABLE_TURN_STATUSES,
  "cancelling"
] as const satisfies readonly TurnStatus[]

/** States nothing may leave. */
export const TERMINAL_TURN_STATUSES = [
  "completed",
  "failed",
  "cancelled"
] as const satisfies readonly TurnStatus[]

export const isTerminalTurnStatus = (status: TurnStatus): boolean =>
  (TERMINAL_TURN_STATUSES as readonly TurnStatus[]).includes(status)

/**
 * Every transition the lifecycle allows, as predecessors per target state.
 *
 * Read this way round because it is how the repository uses it: a status write
 * is a compare-and-set against the states that may precede it, so a message
 * that arrives late — a duplicate stop, a terminal write from a generation the
 * worker already gave up on — cannot move a settled row.
 *
 * `cancelling` accepts every terminal because the abort races the work it
 * aborts: a generation that finished before the signal landed still reports
 * completion, and refusing it would strand the row in an intent that will never
 * be acted on again.
 */
export const TURN_STATUS_PREDECESSORS: Record<
  TurnStatus,
  readonly TurnStatus[]
> = {
  submitted: [],
  building_context: ["submitted", "building_context"],
  generating: ["building_context", "generating"],
  cancelling: ["submitted", "building_context", "generating"],
  completed: ["building_context", "generating", "cancelling"],
  failed: ["submitted", "building_context", "generating", "cancelling"],
  cancelled: ["submitted", "building_context", "generating", "cancelling"]
}

export const canTransitionTurnStatus = (
  from: TurnStatus,
  to: TurnStatus
): boolean => TURN_STATUS_PREDECESSORS[to].includes(from)

export type TurnToast = {
  variant?: "default" | "destructive"
  titleKey: string
  descriptionKey?: string
  descriptionValues?: Record<string, string>
}

/**
 * Versioned evidence of the context actually supplied to a model. It records
 * lengths and source excerpts rather than environment-owned objects, allowing
 * diagnostics and replay to explain a turn after restart.
 */
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

/** Versioned context-build evidence. @see ContextReceiptSchema */
export type ContextReceipt = z.infer<typeof ContextReceiptSchema>

/**
 * Complete versioned input required to resume a submitted turn. Persisted chat
 * messages retain compatibility byte shapes until an application adapter
 * normalizes them.
 */
export const PersistedTurnRequestSchema = z.object({
  version: z.literal(1),
  context: DurableContextOptionsSchema,
  userMessage: ChatMessageSchema
})

/** Persisted turn input before application message normalization. */
export type PersistedTurnRequestParsed = z.infer<
  typeof PersistedTurnRequestSchema
>

/** Parse a persisted turn request without application environment access. */
export const parsePersistedTurnRequest = (
  value: unknown
): PersistedTurnRequestParsed => PersistedTurnRequestSchema.parse(value)
