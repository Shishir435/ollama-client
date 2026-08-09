import type { ToolLoopState } from "@ollama-client/chat-runtime/tool-loop-runtime"
import {
  type ToolLoopMode as ContractToolLoopMode,
  type ToolLoopRunStatus as ContractToolLoopRunStatus,
  DurableToolLoopStateSchema,
  ToolLoopCheckpointEnvelopeSchema
} from "@ollama-client/contracts/tool-loop"
import { createAppError } from "@/lib/error-utils"
import { flushSave, query, run } from "@/lib/sqlite/db"
import type { ToolCall } from "@/lib/tools"
import type { ChatMessage, ToolRun } from "@/types"

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

interface ToolLoopRunRow {
  requestId: string
  sessionId: string | null
  model: string
  providerId: string | null
  mode: string
  status: string
  state: string
  updatedAt: number
}

const parseRow = (row: ToolLoopRunRow): DurableToolLoopRun => {
  try {
    if (
      (row.mode !== "native" &&
        row.mode !== "native-user-results" &&
        row.mode !== "non-native") ||
      (row.status !== "running" && row.status !== "awaiting-confirmation")
    ) {
      throw new Error("Invalid tool-loop mode or status")
    }
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
    throw createAppError("Stored tool-loop checkpoint is invalid", {
      kind: "storage",
      phase: "persistence",
      userMessage:
        "This interrupted tool run could not be resumed safely. Retry the turn.",
      retryable: true,
      recoveryAction: "retry",
      cause
    })
  }
}

export const getToolLoopRun = async (
  requestId: string
): Promise<DurableToolLoopRun | null> => {
  const rows = (await query(
    "SELECT requestId, sessionId, model, providerId, mode, status, state, updatedAt FROM tool_loop_runs WHERE requestId = ?",
    [requestId]
  )) as unknown as ToolLoopRunRow[]
  return rows[0] ? parseRow(rows[0]) : null
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
