import {
  type AppFailure,
  AppFailureSchema
} from "@ollama-client/contracts/app-failure"
import { z } from "zod"
import { flushSave, query, run } from "@/lib/sqlite/db"
import { decodeRow, decodeRows, type RowDecodeContext } from "./row-decoder"

const MODEL_PULL_RUN_STATUSES = [
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled"
] as const

export type ModelPullRunStatus = (typeof MODEL_PULL_RUN_STATUSES)[number]

export interface ModelPullRun {
  id: string
  model: string
  providerId?: string
  status: ModelPullRunStatus
  statusText?: string
  progress?: number
  failure?: AppFailure
  createdAt: number
  updatedAt: number
}

/** @see IngestionRunRowSchema for why the stored shape is described, not asserted. */
const ModelPullRunRowSchema = z.object({
  id: z.string(),
  model: z.string(),
  providerId: z.string().nullable(),
  status: z.enum(MODEL_PULL_RUN_STATUSES),
  statusText: z.string().nullable(),
  progress: z.number().nullable(),
  failure: z.string().nullable(),
  createdAt: z.number(),
  updatedAt: z.number()
})

type ModelPullRunRow = z.infer<typeof ModelPullRunRowSchema>

const TABLE: RowDecodeContext = { table: "model_pull_runs", operation: "read" }

const parseFailure = (value: string | null): AppFailure | undefined => {
  if (!value) return undefined
  try {
    const parsed = AppFailureSchema.safeParse(JSON.parse(value))
    return parsed.success ? parsed.data : undefined
  } catch {
    return undefined
  }
}

const parseRun = (row: ModelPullRunRow): ModelPullRun => ({
  ...row,
  providerId: row.providerId ?? undefined,
  statusText: row.statusText ?? undefined,
  progress: row.progress ?? undefined,
  failure: parseFailure(row.failure)
})

export const saveModelPullRun = async (
  value: ModelPullRun,
  options: { flush?: boolean } = {}
): Promise<void> => {
  await run(
    `INSERT INTO model_pull_runs
      (id, model, providerId, status, statusText, progress, failure, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       status = excluded.status,
       statusText = excluded.statusText,
       progress = excluded.progress,
       failure = excluded.failure,
       updatedAt = excluded.updatedAt`,
    [
      value.id,
      value.model,
      value.providerId ?? null,
      value.status,
      value.statusText ?? null,
      value.progress ?? null,
      value.failure ? JSON.stringify(value.failure) : null,
      value.createdAt,
      value.updatedAt
    ]
  )
  if (options.flush !== false) {
    await flushSave()
  }
}

const selectColumns = `id, model, providerId, status, statusText, progress,
  failure, createdAt, updatedAt`

export const getModelPullRun = async (
  id: string
): Promise<ModelPullRun | null> => {
  const rows = await query(
    `SELECT ${selectColumns} FROM model_pull_runs WHERE id = ?`,
    [id]
  )
  const row = rows[0]
    ? decodeRow(ModelPullRunRowSchema, rows[0], TABLE)
    : undefined
  return row ? parseRun(row) : null
}

export const listActiveModelPullRuns = async (): Promise<ModelPullRun[]> => {
  const rows = await query(
    `SELECT ${selectColumns} FROM model_pull_runs
     WHERE status IN ('queued', 'running')
     ORDER BY createdAt ASC`
  )
  return decodeRows(ModelPullRunRowSchema, rows, TABLE).map(parseRun)
}

export const findActiveModelPullRun = async (
  model: string,
  providerId?: string
): Promise<ModelPullRun | null> => {
  const rows = await query(
    `SELECT ${selectColumns} FROM model_pull_runs
     WHERE model = ?
       AND COALESCE(providerId, '') = COALESCE(?, '')
       AND status IN ('queued', 'running')
     ORDER BY createdAt ASC
     LIMIT 1`,
    [model, providerId ?? null]
  )
  const row = rows[0]
    ? decodeRow(ModelPullRunRowSchema, rows[0], TABLE)
    : undefined
  return row ? parseRun(row) : null
}
