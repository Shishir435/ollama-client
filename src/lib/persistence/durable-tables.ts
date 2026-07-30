// Which tables the chat-history migration has to account for, and the
// engine-agnostic verification helpers used on both sides of it.
//
// The list is explicit rather than derived at runtime, so a mismatch is a
// review-time failure instead of a silent gap: a table that lands in
// `schema.ts` without landing here would migrate unverified. That pairing is
// enforced by `__tests__/durable-tables.test.ts`.

export const DURABLE_TABLES = [
  "sessions",
  "messages",
  "files",
  "kv_store",
  "prompt_templates",
  "tool_loop_runs",
  "turn_runs",
  "ingestion_runs",
  "model_pull_runs",
  "chunk_feedback"
] as const

export type DurableTable = (typeof DURABLE_TABLES)[number]

/** Row counts per table. Partial: a table absent from the source database is
 * unknown, not empty — an old profile predates most of these tables and the
 * schema runner creates them empty after the import. */
export type TableCounts = Partial<Record<DurableTable, number>>

export interface IntegrityReport {
  /** `PRAGMA integrity_check` output, joined. "ok" when the file is sound. */
  integrityCheck: string
  /** `PRAGMA foreign_key_check` row count. */
  foreignKeyViolations: number
}

export interface TableCountMismatch {
  table: DurableTable
  source: number
  imported: number
}

/** Minimal reader both engines can satisfy: one scalar per statement. */
export type ScalarReader = (sql: string) => number

/** Minimal reader for the pragma checks, which return text rows. */
export type RowReader = (sql: string) => unknown[][]

const quoted = (table: string): string => `"${table.replace(/"/g, '""')}"`

export const listExistingDurableTables = (
  exists: (table: DurableTable) => boolean
): DurableTable[] => DURABLE_TABLES.filter((table) => exists(table))

export const countDurableTables = (
  read: ScalarReader,
  exists: (table: DurableTable) => boolean
): TableCounts => {
  const counts: TableCounts = {}
  for (const table of listExistingDurableTables(exists)) {
    counts[table] = read(`SELECT COUNT(*) FROM ${quoted(table)}`)
  }
  return counts
}

export const tableExistsSql = (table: string): string =>
  `SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = '${table.replace(/'/g, "''")}'`

/**
 * Every table the source database had must arrive with the same row count.
 *
 * Only source tables are compared. The import runs forward migrations, so the
 * destination legitimately gains tables the source never had; the reverse —
 * a source table missing or short after the import — is data loss.
 */
export const findTableCountMismatches = (
  source: TableCounts,
  imported: TableCounts
): TableCountMismatch[] => {
  const mismatches: TableCountMismatch[] = []
  for (const table of DURABLE_TABLES) {
    const expected = source[table]
    if (expected === undefined) continue
    const actual = imported[table] ?? 0
    if (actual !== expected) {
      mismatches.push({ table, source: expected, imported: actual })
    }
  }
  return mismatches
}

/**
 * Durable tables the destination is missing after an import.
 *
 * Count comparison cannot catch these: a table absent from the source is
 * skipped, because forward migrations are expected to create it empty. That
 * expectation is only as good as the migration set — `chunk_feedback` was added
 * to the schema in 0.10.0 with no migration behind it, so a database that
 * predates it stayed without the table and verification called that success.
 *
 * Checked against the destination's own table list rather than the source's, so
 * the next table added without a migration fails the migration instead of
 * shipping a profile that raises "no such table" at the first write.
 */
export const findMissingDurableTables = (
  imported: TableCounts
): DurableTable[] =>
  DURABLE_TABLES.filter((table) => imported[table] === undefined)

/**
 * Describe a failed verification as shortfalls, not as count pairs.
 *
 * This text becomes the thrown error, which is stored as the receipt's `failure`
 * and can be carried into a support report. `messages 39199/39204` would put
 * history volume in that report; `messages short by 5` diagnoses the same defect
 * without it. The absolute counts stay in the receipt's structured
 * `sourceCounts`/`importedCounts`, which never leave the device.
 */
export const describeMismatches = (
  mismatches: readonly TableCountMismatch[]
): string =>
  mismatches
    .map((mismatch) => {
      const delta = mismatch.source - mismatch.imported
      return delta > 0
        ? `${mismatch.table} short by ${delta}`
        : `${mismatch.table} over by ${-delta}`
    })
    .join(", ")

export const readIntegrityReport = (read: RowReader): IntegrityReport => {
  const integrityRows = read("PRAGMA integrity_check")
  const integrityCheck =
    integrityRows
      .map((row) => String(row[0] ?? ""))
      .filter((line) => line.length > 0)
      .join("; ") || "ok"
  return {
    integrityCheck,
    foreignKeyViolations: read("PRAGMA foreign_key_check").length
  }
}

export const isSoundDatabase = (report: IntegrityReport): boolean =>
  report.integrityCheck === "ok"
