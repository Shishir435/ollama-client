import { z } from "zod"
import { flushSave, query, run } from "@/lib/sqlite/db"
import { decodeRow, decodeRows } from "./row-decoder"

const INGESTION_RUN_STATUSES = [
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled"
] as const

export type IngestionRunStatus = (typeof INGESTION_RUN_STATUSES)[number]

const INGESTION_PHASES = [
  "queued",
  "parsing",
  "registering",
  "embedding",
  "committing",
  "completed",
  "compensating"
] as const

export type IngestionPhase = (typeof INGESTION_PHASES)[number]

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

/**
 * The stored row, as SQLite hands it back rather than as the application wants
 * it: booleans are integers, absent values are null, and both enums are plain
 * text that a half-applied migration or a newer build could fill with something
 * this version has never heard of.
 */
const IngestionRunRowSchema = z.object({
  id: z.string(),
  fileId: z.string(),
  knowledgeSetId: z.string(),
  fileName: z.string(),
  status: z.enum(INGESTION_RUN_STATUSES),
  phase: z.enum(INGESTION_PHASES),
  autoEmbed: z.number(),
  failure: z.string().nullable(),
  createdAt: z.number(),
  updatedAt: z.number()
})

type IngestionRunRow = z.infer<typeof IngestionRunRowSchema>

const TABLE = { table: "ingestion_runs", operation: "read" } as const

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
  )) as unknown[]
  const row = rows[0]
    ? decodeRow(IngestionRunRowSchema, rows[0], TABLE)
    : undefined
  return row ? parseRun(row) : null
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
  )) as unknown[]
  return decodeRows(IngestionRunRowSchema, rows, TABLE).map(parseRun)
}
