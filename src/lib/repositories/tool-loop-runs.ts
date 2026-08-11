import type { ToolLoopState } from "@ollama-client/chat-runtime/tool-loop-runtime"
import {
  type ToolLoopMode as ContractToolLoopMode,
  type ToolLoopRunStatus as ContractToolLoopRunStatus,
  DurableToolLoopStateSchema,
  ToolLoopCheckpointEnvelopeSchema
} from "@ollama-client/contracts/tool-loop"
import { z } from "zod"
import { createAppError } from "@/lib/error-utils"
import { flushSave, query, run } from "@/lib/sqlite/db"
import type { ToolCall } from "@/lib/tools"
import type { ChatMessage, ToolRun } from "@/types"
import { decodeRow, type RowDecodeContext } from "./row-decoder"

export type ToolLoopMode = ContractToolLoopMode
export type ToolLoopRunStatus = ContractToolLoopRunStatus

export type DurableToolLoopState = ToolLoopState<
  ChatMessage,
  ToolRun,
  ToolCall,
  ChatMessage["metrics"]
>

export interface DurableToolLoopRun {
  requestId: string
  sessionId?: string
  model: string
  providerId?: string
  mode: ToolLoopMode
  status: ToolLoopRunStatus
  state: DurableToolLoopState
  updatedAt: number
}

const TABLE: RowDecodeContext = {
  table: "tool_loop_runs",
  operation: "read"
}

const invalidCheckpoint = (cause: unknown) =>
  createAppError("Stored tool-loop checkpoint is invalid", {
    kind: "storage",
    phase: "persistence",
    userMessage:
      "This interrupted tool run could not be resumed safely. Retry the turn.",
    retryable: true,
    recoveryAction: "retry",
    cause
  })

/**
 * The stored row. Mode and status are validated here rather than by a hand
 * written chain of inequalities in `parseRow` — same rejection, one place, and
 * the enum members stay next to the columns they describe.
 */
const ToolLoopRunRowSchema = z.object({
  requestId: z.string(),
  sessionId: z.string().nullable(),
  model: z.string(),
  providerId: z.string().nullable(),
  mode: z.enum(["native", "native-user-results", "non-native"]),
  status: z.enum(["running", "awaiting-confirmation"]),
  state: z.string(),
  updatedAt: z.number()
})

type ToolLoopRunRow = z.infer<typeof ToolLoopRunRowSchema>

const parseRow = (row: ToolLoopRunRow): DurableToolLoopRun => {
  try {
    const decoded: unknown = JSON.parse(row.state)
    // Rows written before checkpoint versioning stored state directly. Keep
    // that one compatibility shape, but validate it through the same schema.
    const stateCandidate =
      decoded && typeof decoded === "object" && "version" in decoded
        ? ToolLoopCheckpointEnvelopeSchema.parse(decoded).state
        : DurableToolLoopStateSchema.parse(decoded)
    return {
      requestId: row.requestId,
      sessionId: row.sessionId ?? undefined,
      model: row.model,
      providerId: row.providerId ?? undefined,
      mode: row.mode,
      status: row.status,
      state: stateCandidate as DurableToolLoopState,
      updatedAt: row.updatedAt
    }
  } catch (cause) {
    throw invalidCheckpoint(cause)
  }
}

export const getToolLoopRun = async (
  requestId: string
): Promise<DurableToolLoopRun | null> => {
  const rows = await query(
    "SELECT requestId, sessionId, model, providerId, mode, status, state, updatedAt FROM tool_loop_runs WHERE requestId = ?",
    [requestId]
  )
  if (!rows[0]) return null
  const row = decodeRow(ToolLoopRunRowSchema, rows[0], TABLE)
  // A checkpoint that will not decode is reported, not skipped: the caller is
  // mid-resume and has to be told the turn cannot be continued safely.
  if (!row) throw invalidCheckpoint(new Error("Stored row shape is invalid"))
  return parseRow(row)
}

/**
 * Persist and force-flush before returning. Approval boundaries cannot rely on
 * normal 1s autosave because MV3 may stop the worker while the user decides.
 */
export const saveToolLoopRun = async (
  value: DurableToolLoopRun
): Promise<void> => {
  await run(
    `INSERT INTO tool_loop_runs
      (requestId, sessionId, model, providerId, mode, status, state, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(requestId) DO UPDATE SET
       sessionId = excluded.sessionId,
       model = excluded.model,
       providerId = excluded.providerId,
       mode = excluded.mode,
       status = excluded.status,
       state = excluded.state,
       updatedAt = excluded.updatedAt`,
    [
      value.requestId,
      value.sessionId ?? null,
      value.model,
      value.providerId ?? null,
      value.mode,
      value.status,
      JSON.stringify({ version: 1, state: value.state }),
      value.updatedAt
    ]
  )
  await flushSave()
}

export const deleteToolLoopRun = async (requestId: string): Promise<void> => {
  await run("DELETE FROM tool_loop_runs WHERE requestId = ?", [requestId])
  await flushSave()
}

/** Remove abandoned checkpoints whose owning sidepanel can no longer resume. */
export const pruneStaleToolLoopRuns = async (
  olderThan = Date.now() - 24 * 60 * 60 * 1000
): Promise<void> => {
  await run("DELETE FROM tool_loop_runs WHERE updatedAt < ?", [olderThan])
  await flushSave()
}
