import { flushSave, query, run } from "@/lib/sqlite/db"

export type IngestionRunStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"

export type IngestionPhase =
  | "queued"
  | "registering"
  | "embedding"
  | "committing"
  | "completed"
  | "compensating"

export interface IngestionRun {
  id: string
  fileId: string
  knowledgeSetId: string
  fileName: string
  status: IngestionRunStatus
  phase: IngestionPhase
  autoEmbed: boolean
  failure?: string
  createdAt: number
  updatedAt: number
}

interface IngestionRunRow extends Omit<IngestionRun, "autoEmbed" | "failure"> {
  autoEmbed: number
  failure: string | null
}

const parseRun = (row: IngestionRunRow): IngestionRun => ({
  ...row,
  autoEmbed: row.autoEmbed === 1,
  failure: row.failure ?? undefined
})

export const saveIngestionRun = async (value: IngestionRun): Promise<void> => {
  await run(
    `INSERT INTO ingestion_runs
      (id, fileId, knowledgeSetId, fileName, status, phase, autoEmbed, failure, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       status = excluded.status,
       phase = excluded.phase,
       failure = excluded.failure,
       updatedAt = excluded.updatedAt`,
    [
      value.id,
      value.fileId,
      value.knowledgeSetId,
      value.fileName,
      value.status,
      value.phase,
      value.autoEmbed ? 1 : 0,
      value.failure ?? null,
      value.createdAt,
      value.updatedAt
    ]
  )
  await flushSave()
}

export const getIngestionRun = async (
  id: string
): Promise<IngestionRun | null> => {
  const rows = (await query(
    `SELECT id, fileId, knowledgeSetId, fileName, status, phase,
      autoEmbed, failure, createdAt, updatedAt
     FROM ingestion_runs WHERE id = ?`,
    [id]
  )) as unknown as IngestionRunRow[]
  return rows[0] ? parseRun(rows[0]) : null
}

export const listIncompleteIngestionRuns = async (): Promise<
  IngestionRun[]
> => {
  const rows = (await query(
    `SELECT id, fileId, knowledgeSetId, fileName, status, phase,
      autoEmbed, failure, createdAt, updatedAt
     FROM ingestion_runs
     WHERE status IN ('queued', 'running')
     ORDER BY createdAt ASC`
  )) as unknown as IngestionRunRow[]
  return rows.map(parseRun)
}
