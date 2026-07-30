import { flushSave, query, run } from "@/lib/sqlite/db"
import { type AppFailure, AppFailureSchema } from "@/protocol/app-failure"

export type ModelPullRunStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"

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

interface ModelPullRunRow
  extends Omit<
    ModelPullRun,
    "providerId" | "statusText" | "progress" | "failure"
  > {
  providerId: string | null
  statusText: string | null
  progress: number | null
  failure: string | null
}

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
  const rows = (await query(
    `SELECT ${selectColumns} FROM model_pull_runs WHERE id = ?`,
    [id]
  )) as unknown as ModelPullRunRow[]
  return rows[0] ? parseRun(rows[0]) : null
}

export const listActiveModelPullRuns = async (): Promise<ModelPullRun[]> => {
  const rows = (await query(
    `SELECT ${selectColumns} FROM model_pull_runs
     WHERE status IN ('queued', 'running')
     ORDER BY createdAt ASC`
  )) as unknown as ModelPullRunRow[]
  return rows.map(parseRun)
}

export const findActiveModelPullRun = async (
  model: string,
  providerId?: string
): Promise<ModelPullRun | null> => {
  const rows = (await query(
    `SELECT ${selectColumns} FROM model_pull_runs
     WHERE model = ?
       AND COALESCE(providerId, '') = COALESCE(?, '')
       AND status IN ('queued', 'running')
     ORDER BY createdAt ASC
     LIMIT 1`,
    [model, providerId ?? null]
  )) as unknown as ModelPullRunRow[]
  return rows[0] ? parseRun(rows[0]) : null
}
