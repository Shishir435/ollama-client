import {
  ContextReceiptSchema,
  TurnModeSchema,
  TurnStatusSchema
} from "@ollama-client/contracts/turns"
import {
  type DurableTurnRun,
  parsePersistedTurnRequest,
  type TurnStatus,
  type TurnSubmission
} from "@/application/turns/turn-contract"
import { flushSave, query, run } from "@/lib/sqlite/db"
import { type AppFailure, AppFailureSchema } from "@/protocol/app-failure"

interface TurnRunRow {
  id: string
  sessionId: string
  mode: string
  model: string
  providerId: string | null
  status: string
  request: string
  contextReceipt: string | null
  userMessageId: number | null
  assistantMessageId: number | null
  failure: string | null
  createdAt: number
  updatedAt: number
}

const parseRow = (row: TurnRunRow): DurableTurnRun | null => {
  try {
    const mode = TurnModeSchema.parse(row.mode)
    const status = TurnStatusSchema.parse(row.status)
    const receipt = row.contextReceipt
      ? ContextReceiptSchema.parse(JSON.parse(row.contextReceipt))
      : undefined

    const failure = row.failure
      ? (() => {
          try {
            return AppFailureSchema.parse(JSON.parse(row.failure))
          } catch {
            return {
              status: 0,
              message: row.failure,
              kind: "unknown" as const
            }
          }
        })()
      : undefined

    return {
      id: row.id,
      sessionId: row.sessionId,
      mode,
      model: row.model,
      providerId: row.providerId ?? undefined,
      status,
      request: parsePersistedTurnRequest(JSON.parse(row.request)),
      contextReceipt: receipt,
      userMessageId: row.userMessageId ?? undefined,
      assistantMessageId: row.assistantMessageId ?? undefined,
      failure,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    }
  } catch {
    return null
  }
}

export const createTurnRun = async (
  submission: TurnSubmission
): Promise<void> => {
  await run(
    `INSERT INTO turn_runs
      (id, sessionId, mode, model, providerId, status, request, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, 'submitted', ?, ?, ?)`,
    [
      submission.id,
      submission.sessionId,
      submission.mode,
      submission.model,
      submission.providerId ?? null,
      JSON.stringify(submission.request),
      submission.createdAt,
      submission.createdAt
    ]
  )
  await flushSave()
}

export const getTurnRun = async (
  id: string
): Promise<DurableTurnRun | null> => {
  const rows = (await query(
    `SELECT id, sessionId, mode, model, providerId, status, request,
            contextReceipt, userMessageId, assistantMessageId, failure,
            createdAt, updatedAt
       FROM turn_runs
      WHERE id = ?`,
    [id]
  )) as unknown as TurnRunRow[]
  return rows[0] ? parseRow(rows[0]) : null
}

export const getIncompleteTurnRuns = async (): Promise<DurableTurnRun[]> => {
  const rows = (await query(
    `SELECT id, sessionId, mode, model, providerId, status, request,
            contextReceipt, userMessageId, assistantMessageId, failure,
            createdAt, updatedAt
       FROM turn_runs
      WHERE status IN ('submitted', 'building-context', 'generating')
      ORDER BY createdAt ASC`
  )) as unknown as TurnRunRow[]
  return rows.flatMap((row) => {
    const parsed = parseRow(row)
    return parsed ? [parsed] : []
  })
}

export const updateTurnRun = async (
  id: string,
  updates: {
    status?: TurnStatus
    contextReceipt?: DurableTurnRun["contextReceipt"]
    userMessageId?: number
    assistantMessageId?: number
    failure?: AppFailure | null
  }
): Promise<void> => {
  const fields: string[] = []
  const values: Array<string | number | null> = []

  if (updates.status) {
    fields.push("status = ?")
    values.push(updates.status)
  }
  if (updates.contextReceipt) {
    fields.push("contextReceipt = ?")
    values.push(JSON.stringify(updates.contextReceipt))
  }
  if (updates.userMessageId !== undefined) {
    fields.push("userMessageId = ?")
    values.push(updates.userMessageId)
  }
  if (updates.assistantMessageId !== undefined) {
    fields.push("assistantMessageId = ?")
    values.push(updates.assistantMessageId)
  }
  if (updates.failure !== undefined) {
    fields.push("failure = ?")
    values.push(
      updates.failure === null ? null : JSON.stringify(updates.failure)
    )
  }
  if (fields.length === 0) return

  fields.push("updatedAt = ?")
  values.push(Date.now(), id)
  await run(`UPDATE turn_runs SET ${fields.join(", ")} WHERE id = ?`, values)
  await flushSave()
}
