import {
  type AppFailure,
  AppFailureSchema
} from "@ollama-client/contracts/app-failure"
import {
  type ContextReceipt,
  ContextReceiptSchema,
  compactedTurnRequest,
  isCompactedTurnRequest,
  isTerminalTurnStatus,
  RESUMABLE_TURN_STATUSES,
  TERMINAL_TURN_STATUSES,
  TURN_STATUS_PREDECESSORS,
  TurnModeSchema,
  type TurnStatus,
  TurnStatusSchema
} from "@ollama-client/contracts/turns"
import { z } from "zod"
import {
  type DurableTurnRun,
  parsePersistedTurnRequest,
  type TurnSubmission
} from "@/application/turns/turn-contract"
import { logger } from "@/lib/logger"
import { flushSave, query, run, runWithMeta } from "@/lib/sqlite/db"
import { decodeRow, decodeRows, type RowDecodeContext } from "./row-decoder"

/**
 * The lifecycle columns, as SQLite hands them back.
 *
 * `mode` and `status` stay untyped text here on purpose: they are validated by
 * their own contract schemas a line later, and letting this schema reject them
 * first would turn a row carrying a status from a newer build into "shape is
 * wrong" instead of the specific answer each reader wants — quarantine for
 * recovery, `null` for the reconnect snapshot.
 */
const TurnRunLifecycleRowSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  model: z.string(),
  providerId: z.string().nullable(),
  status: z.string(),
  contextReceipt: z.string().nullable(),
  userMessageId: z.number().nullable(),
  assistantMessageId: z.number().nullable(),
  failure: z.string().nullable(),
  createdAt: z.number(),
  updatedAt: z.number()
})

/** The lifecycle columns plus the two a resumable row is rebuilt from. */
const TurnRunRowSchema = TurnRunLifecycleRowSchema.extend({
  mode: z.string(),
  request: z.string()
})

type TurnRunRow = z.infer<typeof TurnRunRowSchema>

/** Last resort: enough of a row to settle it when nothing else decoded. */
const TurnRunIdRowSchema = z.object({ id: z.string() })

/** The read behind `getInterruptedCancellations`. */
const CancellingRowSchema = z.object({
  id: z.string(),
  assistantMessageId: z.number().nullable()
})

/**
 * The aggregate behind `getTurnStorageStats`.
 *
 * Every column but `status` is nullable because SQL aggregates say so: `SUM`
 * and `MAX` over an empty group are NULL, and a group with no rows is what an
 * empty table produces.
 */
const TurnStorageStatsRowSchema = z.object({
  status: z.string(),
  runs: z.number().nullable(),
  totalBytes: z.number().nullable(),
  largestBytes: z.number().nullable(),
  uncompacted: z.number().nullable()
})

const TABLE: RowDecodeContext = { table: "turn_runs", operation: "read" }

const safeJson = (value: string): unknown => {
  try {
    return JSON.parse(value)
  } catch {
    return undefined
  }
}

const parseFailure = (value: string | null): AppFailure | undefined => {
  if (!value) return undefined
  try {
    return AppFailureSchema.parse(JSON.parse(value))
  } catch {
    return { status: 0, message: value, kind: "unknown" as const }
  }
}

const parseRow = (row: TurnRunRow): DurableTurnRun | null => {
  try {
    const mode = TurnModeSchema.parse(row.mode)
    const status = TurnStatusSchema.parse(row.status)
    const receipt = row.contextReceipt
      ? ContextReceiptSchema.parse(JSON.parse(row.contextReceipt))
      : undefined

    const failure = parseFailure(row.failure)

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

/**
 * A turn's lifecycle state without the input that produced it.
 *
 * Readers that only need to know how a turn ended — the reconnect snapshot,
 * diagnostics — get this. A terminal row no longer stores its request at all,
 * so a shape that demanded one would report every settled turn as missing.
 */
export interface TurnLifecycleRecord {
  id: string
  sessionId: string
  status: TurnStatus
  model: string
  providerId?: string
  userMessageId?: number
  assistantMessageId?: number
  contextReceipt?: ContextReceipt
  failure?: AppFailure
  createdAt: number
  updatedAt: number
}

export const getTurnRun = async (
  id: string
): Promise<TurnLifecycleRecord | null> => {
  const rows = await query(
    `SELECT id, sessionId, model, providerId, status, contextReceipt,
            userMessageId, assistantMessageId, failure, createdAt, updatedAt
       FROM turn_runs
      WHERE id = ?`,
    [id]
  )
  if (!rows[0]) return null
  const row = decodeRow(TurnRunLifecycleRowSchema, rows[0], TABLE)
  if (!row) return null

  const status = TurnStatusSchema.safeParse(row.status)
  if (!status.success) return null

  let receipt: ContextReceipt | undefined
  try {
    receipt = row.contextReceipt
      ? ContextReceiptSchema.parse(JSON.parse(row.contextReceipt))
      : undefined
  } catch {
    // A receipt is evidence, not state. Losing it must not hide the status the
    // reconnecting panel is waiting for.
    receipt = undefined
  }

  return {
    id: row.id,
    sessionId: row.sessionId,
    status: status.data,
    model: row.model,
    providerId: row.providerId ?? undefined,
    userMessageId: row.userMessageId ?? undefined,
    assistantMessageId: row.assistantMessageId ?? undefined,
    contextReceipt: receipt,
    failure: parseFailure(row.failure),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  }
}

const RESUMABLE_STATUS_LIST = RESUMABLE_TURN_STATUSES.map(
  (status) => `'${status}'`
).join(", ")

const TERMINAL_STATUS_LIST = TERMINAL_TURN_STATUSES.map(
  (status) => `'${status}'`
).join(", ")

/**
 * The request column's value once a turn can no longer be resumed.
 *
 * Always written in the same statement as the terminal status, never after it.
 * A separate compaction pass would be a second write that a dying worker can
 * skip, and the row it skipped is exactly the one nothing updates again.
 */
const compactedRequestValue = (): string =>
  JSON.stringify(compactedTurnRequest(Date.now()))

/**
 * Matches a compacted request by its exact leading bytes.
 *
 * A substring search for `"compacted":true` would also match a conversation
 * that happened to contain that text, and the whole point of the statistic is
 * to catch rows the compaction path missed. Both writers — this module and the
 * migration — emit these keys in this order, so the prefix is exact, while a
 * resumable request begins `{"version":1,"context":`.
 */
const COMPACTED_REQUEST_PREFIX = '{"version":1,"compacted":true,%'

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
    `UPDATE turn_runs
        SET status = 'failed', failure = ?, request = ?, updatedAt = ?
      WHERE id = ? AND status IN (${RESUMABLE_STATUS_LIST}, 'cancelling')`,
    [
      JSON.stringify({
        status: 0,
        kind: "storage",
        message: `Durable turn record could not be read: ${reason}`
      }),
      compactedRequestValue(),
      Date.now(),
      id
    ]
  )
  await flushSave()
}

export const getIncompleteTurnRuns = async (): Promise<DurableTurnRun[]> => {
  const rows = await query(
    `SELECT id, sessionId, mode, model, providerId, status, request,
            contextReceipt, userMessageId, assistantMessageId, failure,
            createdAt, updatedAt
       FROM turn_runs
      WHERE status IN (${RESUMABLE_STATUS_LIST})
      ORDER BY createdAt ASC`
  )
  const resumable: DurableTurnRun[] = []
  for (const value of rows) {
    const row = decodeRow(TurnRunRowSchema, value, TABLE)
    const parsed = row ? parseRow(row) : null
    if (parsed) {
      resumable.push(parsed)
      continue
    }
    // A resumable row whose request is already compacted is an inconsistency,
    // not corruption — compaction only ever accompanies a terminal write — but
    // it is just as unresumable, so it settles the same way with a reason that
    // does not misreport the cause.
    const reason = !row
      ? "turn record columns did not decode"
      : isCompactedTurnRequest(safeJson(row.request))
        ? "resumable turn record was already compacted"
        : "unreadable turn record"
    // A row whose columns did not decode may still have a usable id, and
    // without one there is nothing to quarantine — it would be re-read and
    // re-rejected on every boot, which is the failure quarantining exists to
    // end. The id-only read is the last thing that can still identify it.
    const id = row?.id ?? decodeRow(TurnRunIdRowSchema, value, TABLE)?.id
    if (id) await quarantineTurnRun(id, reason).catch(() => undefined)
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

/** A turn settled by startup, and the assistant row still waiting on it. */
export interface CancelledTurnRecord {
  id: string
  assistantMessageId?: number
}

/**
 * Cancellations whose worker died before they finished.
 *
 * Read-only. Startup may finish what the stop started, but it must never
 * reissue provider work to do it — the user already said stop.
 */
export const getInterruptedCancellations = async (): Promise<
  CancelledTurnRecord[]
> => {
  const rows = await query(
    "SELECT id, assistantMessageId FROM turn_runs WHERE status = 'cancelling'"
  )
  return decodeRows(CancellingRowSchema, rows, TABLE).map((row) => ({
    id: row.id,
    assistantMessageId: row.assistantMessageId ?? undefined
  }))
}

/**
 * Settle one cancellation, last.
 *
 * Deliberately per-turn and deliberately after its assistant row is finished.
 * The two writes cannot share a transaction — they belong to different
 * repositories — so the order is the safety property: while the turn still
 * reads `cancelling`, the next boot finds it again and repeats work that is
 * idempotent. Settling the turn first would close that door with the assistant
 * still unfinished, and stale-message recovery would offer a retry for a
 * response the user deliberately stopped.
 */
export const finalizeCancelledTurn = async (id: string): Promise<boolean> => {
  const result = await runWithMeta(
    `UPDATE turn_runs SET status = 'cancelled', request = ?, updatedAt = ?
      WHERE id = ? AND status = 'cancelling'`,
    [compactedRequestValue(), Date.now(), id]
  )
  if (result.changes > 0) await flushSave()
  return result.changes > 0
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
    // Compacted in the transition itself, so the row that stops being
    // resumable stops carrying resumable data at the same instant.
    if (isTerminalTurnStatus(updates.status)) {
      fields.push("request = ?")
      values.push(compactedRequestValue())
    }
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

/** Default retention for settled turns: a month of lifecycle receipts. */
export const TERMINAL_TURN_RETENTION_MS = 30 * 24 * 60 * 60 * 1000

/**
 * Drop lifecycle receipts nobody can still act on.
 *
 * Compaction bounds what a settled turn costs; this bounds how many of them
 * accumulate. Deleting a receipt removes no conversation — the messages it
 * points at are their own rows and outlive it — so the only thing lost is the
 * ability to explain a turn that ended a month ago.
 *
 * Live rows are excluded by status rather than by age: a turn interrupted by a
 * browser that stayed closed for five weeks is still resumable, and recovery,
 * not a retention sweep, decides what becomes of it.
 */
export const pruneTerminalTurnRuns = async (
  olderThan = Date.now() - TERMINAL_TURN_RETENTION_MS,
  signal?: AbortSignal
): Promise<number> => {
  signal?.throwIfAborted()
  const result = await runWithMeta(
    `DELETE FROM turn_runs
      WHERE status IN (${TERMINAL_STATUS_LIST}) AND updatedAt < ?`,
    [olderThan]
  )
  if (result.changes > 0) {
    logger.info("Pruned settled durable turn receipts", "TurnRuns", {
      count: result.changes
    })
    await flushSave()
  }
  signal?.throwIfAborted()
  return result.changes
}

/** Size and lifecycle counts for `turn_runs`, naming no stored content. */
export interface TurnStorageStats {
  liveRuns: number
  terminalRuns: number
  /** Terminal rows still holding a pre-compaction request payload. */
  uncompactedTerminalRuns: number
  totalRequestBytes: number
  largestRequestBytes: number
}

/**
 * Measure what durable turns cost, without reading what they contain.
 *
 * Every value is a count or a byte length. `uncompactedTerminalRuns` is the
 * number that matters after an upgrade: it should be zero, and a non-zero one
 * means the migration did not reach rows the compaction path also never
 * revisits.
 */
export const getTurnStorageStats = async (): Promise<TurnStorageStats> => {
  const rows = await query(
    `SELECT status,
            COUNT(*) AS runs,
            SUM(LENGTH(CAST(request AS BLOB))) AS totalBytes,
            MAX(LENGTH(CAST(request AS BLOB))) AS largestBytes,
            SUM(CASE WHEN request LIKE ? THEN 0 ELSE 1 END) AS uncompacted
       FROM turn_runs
      GROUP BY status`,
    [COMPACTED_REQUEST_PREFIX]
  )
  const grouped = decodeRows(TurnStorageStatsRowSchema, rows, TABLE)

  const stats: TurnStorageStats = {
    liveRuns: 0,
    terminalRuns: 0,
    uncompactedTerminalRuns: 0,
    totalRequestBytes: 0,
    largestRequestBytes: 0
  }

  for (const row of grouped) {
    const runs = Number(row.runs ?? 0)
    stats.totalRequestBytes += Number(row.totalBytes ?? 0)
    stats.largestRequestBytes = Math.max(
      stats.largestRequestBytes,
      Number(row.largestBytes ?? 0)
    )
    const parsed = TurnStatusSchema.safeParse(row.status)
    if (parsed.success && isTerminalTurnStatus(parsed.data)) {
      stats.terminalRuns += runs
      stats.uncompactedTerminalRuns += Number(row.uncompacted ?? 0)
      continue
    }
    stats.liveRuns += runs
  }

  return stats
}
