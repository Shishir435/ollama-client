import type { z } from "zod"
import { logger } from "@/lib/logger"

/**
 * Where a decode failure happened, for a log line that names no content.
 *
 * The table and operation are ours; the row id, when it decodes, is a
 * repository-generated identifier rather than user data. Nothing else from the
 * row is ever recorded — a `messages` row carries the conversation, and a
 * `turn_runs` row used to carry the whole thing twice.
 */
export interface RowDecodeContext {
  table: string
  operation: string
}

/**
 * Zod issue paths and codes, never messages.
 *
 * A message like `Invalid enum value. Expected 'a' | 'b', received 'x'` embeds
 * the stored value, and a column that fails to decode is exactly the column we
 * cannot assume is safe to write down.
 */
const describeIssues = (error: z.ZodError): string[] =>
  error.issues
    .slice(0, 5)
    .map((issue) => `${issue.path.join(".") || "(root)"}:${issue.code}`)

const rowId = (value: unknown): string | undefined => {
  if (!value || typeof value !== "object") return undefined
  for (const key of ["id", "requestId"]) {
    const candidate = (value as Record<string, unknown>)[key]
    if (typeof candidate === "string") return candidate
  }
  return undefined
}

/**
 * Decode one queried row, or resolve `null` when the stored shape is not what
 * the repository expects.
 *
 * `query` resolves `QueryResult[]` — a bag of `SqlValue`s the driver knows
 * nothing about — and every durable repository used to assert its row type onto
 * that with `as unknown as Row[]`. The assertion is unconditionally true and
 * unconditionally unchecked: a column dropped by a half-applied migration, a
 * status string from a newer version, or a JSON blob written by a build that
 * has since changed shape all arrive as a well-typed object that is wrong, and
 * the first thing to notice is whatever reads a field several layers up.
 */
export const decodeRow = <T>(
  schema: z.ZodType<T>,
  value: unknown,
  context: RowDecodeContext
): T | null => {
  const parsed = schema.safeParse(value)
  if (parsed.success) return parsed.data
  logger.warn("Refused an unreadable durable row", "RowDecoder", {
    table: context.table,
    operation: context.operation,
    ...(rowId(value) ? { rowId: rowId(value) } : {}),
    issues: describeIssues(parsed.error)
  })
  return null
}

/**
 * Decode every queried row, dropping the ones that do not match.
 *
 * One unreadable row must not deny the caller the readable ones: these lists
 * drive restart recovery, and a single bad checkpoint taking down resumption
 * for every other job is a worse failure than losing the job it describes.
 * Each drop is logged, so a row that disappears from recovery leaves evidence
 * rather than silence.
 */
export const decodeRows = <T>(
  schema: z.ZodType<T>,
  values: readonly unknown[],
  context: RowDecodeContext
): T[] => {
  const decoded: T[] = []
  for (const value of values) {
    const row = decodeRow(schema, value, context)
    if (row) decoded.push(row)
  }
  return decoded
}
