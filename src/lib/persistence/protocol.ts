import { z } from "zod"
import type { IntegrityReport, TableCounts } from "./durable-tables"

/**
 * Production wire key between stateless database clients and the session's
 * single SQLite owner (Chromium offscreen document or Firefox background page).
 */
export const PERSISTENCE_RPC = "persistence-rpc"
export const PERSISTENCE_ENSURE = "persistence-ensure"
/** Storage-marker proxy key used because offscreen documents lack storage. */
export const PERSISTENCE_MARKER = "persistence-marker"

export type SqlValue = string | number | null | Uint8Array
export type QueryRow = Record<string, SqlValue>

/** Generous abuse limits. Normal application operations remain far below them. */
export const PERSISTENCE_LIMITS = {
  sqlChars: 1_000_000,
  bindValues: 20_000,
  textValueChars: 128 * 1024 * 1024,
  blobBytes: 128 * 1024 * 1024,
  importBytes: 1024 * 1024 * 1024,
  transactionTokenChars: 200
} as const

const byteSchema = z.number().int().min(0).max(255)
const byteArraySchema = (limit: number) => z.array(byteSchema).max(limit)
const boundedStringSchema = z.string().max(PERSISTENCE_LIMITS.textValueChars)
const transactionTokenSchema = z
  .string()
  .min(1)
  .max(PERSISTENCE_LIMITS.transactionTokenChars)
const sqlSchema = z.string().min(1).max(PERSISTENCE_LIMITS.sqlChars)

const Uint8ArraySchema = z
  .instanceof(Uint8Array)
  .refine(
    (value) => value.byteLength <= PERSISTENCE_LIMITS.blobBytes,
    "Persistence BLOB exceeds the size limit"
  )

const ArrayBufferSchema = z
  .instanceof(ArrayBuffer)
  .refine(
    (value) => value.byteLength <= PERSISTENCE_LIMITS.importBytes,
    "Persistence database payload exceeds the size limit"
  )

const SqlValueSchema = z.union([
  boundedStringSchema,
  z.number().finite(),
  z.null(),
  Uint8ArraySchema
])

const EncodedBlobSchema = z
  .object({
    __persistenceBlob: z.literal(true),
    bytes: byteArraySchema(PERSISTENCE_LIMITS.blobBytes)
  })
  .strict()

const WireSqlValueSchema = z.union([
  boundedStringSchema,
  z.number().finite(),
  z.null(),
  EncodedBlobSchema
])

const transactionField = { tx: transactionTokenSchema.optional() }
const bindField = {
  bind: z.array(SqlValueSchema).max(PERSISTENCE_LIMITS.bindValues).optional()
}
const wireBindField = {
  bind: z
    .array(WireSqlValueSchema)
    .max(PERSISTENCE_LIMITS.bindValues)
    .optional()
}

/** Which topology the owner is serving from. Mirrors `PersistenceBackend` in
 * backend.ts, kept here so the wire types do not depend on the marker module. */
export type PersistenceBackendMode = "legacy" | "opfs"

export type PersistenceOp =
  | { op: "query"; sql: string; bind?: SqlValue[]; tx?: string }
  | { op: "run"; sql: string; bind?: SqlValue[]; tx?: string }
  | { op: "txBegin"; token: string }
  | { op: "txCommit"; token: string }
  | { op: "txRollback"; token: string }
  /**
   * Point the owner at a backend. Sent by the host once per session, after it
   * has decided whether this profile migrated — never by a database client,
   * which has no standing to move a profile between topologies.
   *
   * `integrity` carries the verdict the migration already reached for the same
   * blob, so a legacy open does not repeat a full scan the host just performed.
   */
  | {
      op: "setBackend"
      backend: PersistenceBackendMode
      integrity?: IntegrityReport
    }
  /**
   * Make committed writes durable. A no-op on OPFS, where every commit already
   * is; on the legacy blob it forces the debounced image write. Clients call it
   * at unload and export boundaries without knowing which backend answered.
   */
  | { op: "flush" }
  | { op: "exportDb" }
  | { op: "importDb"; bytes: ArrayBuffer }
  /**
   * Survey a candidate database without adopting it: row counts per durable
   * table, `PRAGMA user_version`, and the integrity verdicts. Read-only, on a
   * scratch file that is unlinked afterwards, so the live database and the
   * source bytes are both untouched.
   *
   * This is how the legacy blob is measured before migration. It exists so the
   * survey runs on the same engine as the import — sql.js read the blob for
   * this, which meant carrying a second SQLite for a read that official
   * sqlite-wasm performs natively.
   */
  | { op: "surveyDb"; bytes: ArrayBuffer }
  | { op: "counts" }
  | { op: "reset" }
  | { op: "ping" }

/** Strict runtime validator used by in-process callers and the worker. */
export const PersistenceOpSchema = z.discriminatedUnion("op", [
  z
    .object({
      op: z.literal("query"),
      sql: sqlSchema,
      ...bindField,
      ...transactionField
    })
    .strict(),
  z
    .object({
      op: z.literal("run"),
      sql: sqlSchema,
      ...bindField,
      ...transactionField
    })
    .strict(),
  z
    .object({ op: z.literal("txBegin"), token: transactionTokenSchema })
    .strict(),
  z
    .object({ op: z.literal("txCommit"), token: transactionTokenSchema })
    .strict(),
  z
    .object({ op: z.literal("txRollback"), token: transactionTokenSchema })
    .strict(),
  z
    .object({
      op: z.literal("setBackend"),
      backend: z.enum(["legacy", "opfs"]),
      integrity: z
        .object({
          integrityCheck: z.string(),
          foreignKeyViolations: z.number().int().nonnegative()
        })
        .strict()
        .optional()
    })
    .strict(),
  z.object({ op: z.literal("flush") }).strict(),
  z.object({ op: z.literal("exportDb") }).strict(),
  z.object({ op: z.literal("importDb"), bytes: ArrayBufferSchema }).strict(),
  z.object({ op: z.literal("surveyDb"), bytes: ArrayBufferSchema }).strict(),
  z.object({ op: z.literal("counts") }).strict(),
  z.object({ op: z.literal("reset") }).strict(),
  z.object({ op: z.literal("ping") }).strict()
])

/** Runtime-message shape before encoded BLOBs and database bytes are decoded. */
export const PersistenceWireOpSchema = z.discriminatedUnion("op", [
  z
    .object({
      op: z.literal("query"),
      sql: sqlSchema,
      ...wireBindField,
      ...transactionField
    })
    .strict(),
  z
    .object({
      op: z.literal("run"),
      sql: sqlSchema,
      ...wireBindField,
      ...transactionField
    })
    .strict(),
  z
    .object({ op: z.literal("txBegin"), token: transactionTokenSchema })
    .strict(),
  z
    .object({ op: z.literal("txCommit"), token: transactionTokenSchema })
    .strict(),
  z
    .object({ op: z.literal("txRollback"), token: transactionTokenSchema })
    .strict(),
  z.object({ op: z.literal("flush") }).strict(),
  z.object({ op: z.literal("exportDb") }).strict(),
  z
    .object({
      op: z.literal("importDb"),
      bytes: byteArraySchema(PERSISTENCE_LIMITS.importBytes)
    })
    .strict(),
  z
    .object({
      op: z.literal("surveyDb"),
      bytes: byteArraySchema(PERSISTENCE_LIMITS.importBytes)
    })
    .strict(),
  z.object({ op: z.literal("counts") }).strict(),
  z.object({ op: z.literal("reset") }).strict(),
  z.object({ op: z.literal("ping") }).strict()
])

export type PersistenceWireOp = z.infer<typeof PersistenceWireOpSchema>

export interface RunResult {
  lastInsertRowid: number
  changes: number
}

export interface CountsResult {
  sessions: number
  messages: number
  /** Every durable table present in the database. `sessions`/`messages` stay
   * as named fields because callers log them, but migration verification
   * compares the whole map. */
  tables: TableCounts
}

export interface ImportResult extends CountsResult {
  integrity: IntegrityReport
}

/** What a source database says about itself before anything imports it. */
export interface SurveyResult extends ImportResult {
  /** `PRAGMA user_version` — which schema generation the data came from. */
  schemaVersion: number
}

export const PersistenceEnsureRequestSchema = z
  .object({ type: z.literal(PERSISTENCE_ENSURE) })
  .strict()

export const PersistenceRpcRequestSchema = z
  .object({
    type: z.literal(PERSISTENCE_RPC),
    request: PersistenceWireOpSchema
  })
  .strict()

export type PersistenceRpcRequest = z.infer<typeof PersistenceRpcRequestSchema>

/**
 * Device-local persistence state the offscreen owner cannot reach itself.
 *
 * `backend` is the backend marker, `receipt` the migration receipt, and
 * `override` the operator switch that pins a profile to the legacy blob.
 */
export type PersistenceStateScope = "backend" | "receipt" | "override"

const BackendMarkerSchema = z
  .object({
    backend: z.enum(["legacy", "opfs"]),
    migratedAt: z.number().int().nonnegative().optional(),
    sourceCounts: z
      .object({
        sessions: z.number().int().nonnegative(),
        messages: z.number().int().nonnegative()
      })
      .strict()
      .optional()
  })
  .strict()

const IntegrityReportSchema = z
  .object({
    integrityCheck: z.string(),
    foreignKeyViolations: z.number().int().nonnegative()
  })
  .strict()

const TableCountMapSchema = z.record(z.string(), z.number().int().nonnegative())

const MigrationReceiptSchema = z
  .object({
    version: z.literal(1),
    outcome: z.enum(["migrated", "fresh", "failed", "skipped"]),
    recordedAt: z.number().int().nonnegative(),
    extensionVersion: z.string(),
    attempts: z.number().int().positive(),
    sourceSchemaVersion: z.number().int().nonnegative().optional(),
    sourceBytes: z.number().int().nonnegative().optional(),
    sourceCounts: TableCountMapSchema.optional(),
    importedCounts: TableCountMapSchema.optional(),
    sourceIntegrity: IntegrityReportSchema.optional(),
    importedIntegrity: IntegrityReportSchema.optional(),
    mismatches: z
      .array(
        z
          .object({
            table: z.string(),
            source: z.number().int().nonnegative(),
            imported: z.number().int().nonnegative()
          })
          .strict()
      )
      .optional(),
    failure: z.string().optional()
  })
  .strict()

export const PersistenceStateRequestSchema = z.union([
  z
    .object({
      type: z.literal(PERSISTENCE_MARKER),
      action: z.literal("get"),
      scope: z.literal("backend")
    })
    .strict(),
  z
    .object({
      type: z.literal(PERSISTENCE_MARKER),
      action: z.literal("get"),
      scope: z.literal("receipt")
    })
    .strict(),
  z
    .object({
      type: z.literal(PERSISTENCE_MARKER),
      action: z.literal("get"),
      scope: z.literal("override")
    })
    .strict(),
  z
    .object({
      type: z.literal(PERSISTENCE_MARKER),
      action: z.literal("set"),
      scope: z.literal("backend"),
      value: BackendMarkerSchema
    })
    .strict(),
  z
    .object({
      type: z.literal(PERSISTENCE_MARKER),
      action: z.literal("set"),
      scope: z.literal("receipt"),
      value: MigrationReceiptSchema
    })
    .strict(),
  z
    .object({
      type: z.literal(PERSISTENCE_MARKER),
      action: z.literal("set"),
      scope: z.literal("override"),
      value: z.boolean()
    })
    .strict()
])

export type PersistenceStateRequest = z.infer<
  typeof PersistenceStateRequestSchema
>

export const PersistenceEnsureResponseSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true) }).strict(),
  z.object({ ok: z.literal(false), error: z.string() }).strict()
])

export const PersistenceRpcResponseSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), result: z.unknown() }).strict(),
  z.object({ ok: z.literal(false), error: z.string() }).strict()
])

export type PersistenceRpcResponse = z.infer<
  typeof PersistenceRpcResponseSchema
>

export const PersistenceStateResponseSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), value: z.unknown().optional() }).strict(),
  z.object({ ok: z.literal(false), error: z.string() }).strict()
])

/** Ops a client may retry after an owner restart: they either do not write or
 * are safe to repeat. `run` is NOT retryable — a lost response cannot prove
 * the write did not commit. */
export const RETRYABLE_OPS = new Set<PersistenceOp["op"]>([
  "query",
  "counts",
  "exportDb",
  "ping",
  // Idempotent by construction: both re-assert a state the owner should already
  // be in, and a respawned owner is exactly when they need re-asserting.
  "flush",
  "setBackend"
])

/**
 * Blob codec. chrome.runtime messages are JSON-serialized on Chromium, so a
 * Uint8Array (file attachment BLOBs) silently becomes {}. Binds and result
 * rows are therefore encoded before crossing the messaging boundary and
 * decoded on the other side. Worker<->host postMessage uses structured clone
 * and keeps real Uint8Arrays.
 */

interface EncodedBlob {
  __persistenceBlob: true
  bytes: number[]
}

const isEncodedBlob = (value: unknown): value is EncodedBlob =>
  typeof value === "object" &&
  value !== null &&
  (value as EncodedBlob).__persistenceBlob === true &&
  Array.isArray((value as EncodedBlob).bytes)

export const encodeValue = (value: unknown): unknown =>
  value instanceof Uint8Array
    ? ({ __persistenceBlob: true, bytes: Array.from(value) } as EncodedBlob)
    : value

export const decodeValue = (value: unknown): unknown =>
  isEncodedBlob(value) ? Uint8Array.from(value.bytes) : value

export const encodeBind = (bind?: SqlValue[]): unknown[] | undefined =>
  bind?.map((value) => encodeValue(value))

export const decodeBind = (bind?: unknown[]): SqlValue[] | undefined =>
  bind?.map((value) => decodeValue(value)) as SqlValue[] | undefined

/** Convert a validated runtime-message operation into the engine contract. */
export const decodePersistenceWireOp = (
  request: PersistenceWireOp
): PersistenceOp => {
  if (request.op === "query" || request.op === "run") {
    return { ...request, bind: decodeBind(request.bind) }
  }
  if (request.op === "importDb" || request.op === "surveyDb") {
    return {
      ...request,
      bytes: Uint8Array.from(request.bytes).buffer as ArrayBuffer
    }
  }
  return request
}

export const encodeRows = (rows: QueryRow[]): unknown[] =>
  rows.map((row) => {
    const encoded: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(row)) {
      encoded[key] = encodeValue(value)
    }
    return encoded
  })

export const decodeRows = (rows: unknown[]): QueryRow[] =>
  rows.map((row) => {
    const decoded: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(row as Record<string, unknown>)) {
      decoded[key] = decodeValue(value)
    }
    return decoded as QueryRow
  })
