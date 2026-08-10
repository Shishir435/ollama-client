import {
  type AppFailure,
  AppFailureSchema
} from "@ollama-client/contracts/app-failure"
import {
  ContextReceiptSchema,
  RESUMABLE_TURN_STATUSES,
  TURN_STATUS_PREDECESSORS,
  TurnModeSchema,
  type TurnStatus,
  TurnStatusSchema
} from "@ollama-client/contracts/turns"
import {
  type DurableTurnRun,
  parsePersistedTurnRequest,
  type TurnSubmission
} from "@/application/turns/turn-contract"
import { logger } from "@/lib/logger"
import { flushSave, query, run, runWithMeta } from "@/lib/sqlite/db"

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

const RESUMABLE_STATUS_LIST = RESUMABLE_TURN_STATUSES.map(
  (status) => `'${status}'`
).join(", ")

/**
 * Fail a row nothing can read.
 *
 * A row whose request, mode or status will not parse was previously skipped by
 * recovery, silently, on every boot forever. It is terminally failed instead,
 * with a diagnostic that names no content, so the user sees a turn that ended
 * rather than one that quietly never existed.
 */
const quarantineTurnRun = async (id: string, reason: string): Promise<void> => {
  logger.error("Quarantined an unreadable durable turn", "TurnRuns", {
    turnId: id,
    reason
  })
  await run(
    `UPDATE turn_runs SET status = 'failed', failure = ?, updatedAt = ?
      WHERE id = ? AND status IN (${RESUMABLE_STATUS_LIST}, 'cancelling')`,
    [
      JSON.stringify({
        status: 0,
        kind: "storage",
        message: `Durable turn record could not be read: ${reason}`
      }),
      Date.now(),
      id
    ]
  )
  await flushSave()
}

export const getIncompleteTurnRuns = async (): Promise<DurableTurnRun[]> => {
  const rows = (await query(
    `SELECT id, sessionId, mode, model, providerId, status, request,
            contextReceipt, userMessageId, assistantMessageId, failure,
            createdAt, updatedAt
       FROM turn_runs
      WHERE status IN (${RESUMABLE_STATUS_LIST})
      ORDER BY createdAt ASC`
  )) as unknown as TurnRunRow[]
  const resumable: DurableTurnRun[] = []
  for (const row of rows) {
    const parsed = parseRow(row)
    if (parsed) {
      resumable.push(parsed)
      continue
    }
    await quarantineTurnRun(row.id, "unreadable turn record").catch(
      () => undefined
    )
  }
  return resumable
}

/**
 * Commit the user's stop before anything acts on it.
 *
 * Ordering is the whole point: intent lands durably, then the in-memory
 * controller is aborted. A worker that dies in between restarts into
 * `cancelling`, which recovery does not resume — where a row left at
 * `generating` was reissued to the provider as if nothing had been asked.
 *
 * Resolves false when there was no live turn to stop, which is what makes a
 * duplicate stop a no-op rather than a second write.
 */
export const markTurnCancelling = async (id: string): Promise<boolean> => {
  const result = await runWithMeta(
    `UPDATE turn_runs SET status = 'cancelling', updatedAt = ?
      WHERE id = ? AND status IN (${RESUMABLE_STATUS_LIST})`,
    [Date.now(), id]
  )
  if (result.changes > 0) await flushSave()
  return result.changes > 0
}

/**
 * Settle cancellations whose worker died before they finished.
 *
 * Startup may finish what the stop started, but it must never reissue provider
 * work to do it — the user already said stop.
 */
export const finalizeInterruptedCancellations = async (): Promise<number> => {
  const result = await runWithMeta(
    `UPDATE turn_runs SET status = 'cancelled', updatedAt = ?
      WHERE status = 'cancelling'`,
    [Date.now()]
  )
  if (result.changes > 0) await flushSave()
  return result.changes
}

/**
 * Apply a turn update, guarding any status change as a compare-and-set.
 *
 * The write carries the target state's allowed predecessors, so the database
 * decides whether the transition is legal rather than the caller. That is what
 * stops a terminal row regressing when a late message arrives — a duplicate
 * stop, or a generation reporting completion for a turn already recorded as
 * failed — and it holds without an application-level lock across the two
 * workers that can be mid-flight after a restart.
 *
 * Resolves false when a status change was refused. Updates with no status
 * always apply.
 */
export const updateTurnRun = async (
  id: string,
  updates: {
    status?: TurnStatus
    contextReceipt?: DurableTurnRun["contextReceipt"]
    userMessageId?: number
    assistantMessageId?: number
    failure?: AppFailure | null
  }
): Promise<boolean> => {
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
  if (fields.length === 0) return true

  fields.push("updatedAt = ?")
  values.push(Date.now(), id)

  if (!updates.status) {
    await run(`UPDATE turn_runs SET ${fields.join(", ")} WHERE id = ?`, values)
    await flushSave()
    return true
  }

  const predecessors = TURN_STATUS_PREDECESSORS[updates.status]
  if (predecessors.length === 0) return false
  const placeholders = predecessors.map(() => "?").join(", ")
  const result = await runWithMeta(
    `UPDATE turn_runs SET ${fields.join(", ")}
      WHERE id = ? AND status IN (${placeholders})`,
    [...values, ...predecessors]
  )
  if (result.changes === 0) {
    logger.warn("Refused an illegal durable turn transition", "TurnRuns", {
      turnId: id,
      target: updates.status
    })
    return false
  }
  await flushSave()
  return true
}
