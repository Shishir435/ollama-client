/**
 * Production wire key between stateless database clients and the session's
 * single SQLite owner (Chromium offscreen document or Firefox background page).
 */
export const PERSISTENCE_RPC = "persistence-rpc"
export const PERSISTENCE_ENSURE = "persistence-ensure"
/** Storage-marker proxy key used because offscreen documents lack storage. */
export const PERSISTENCE_MARKER = "persistence-marker"

import type { IntegrityReport, TableCounts } from "./durable-tables"

export type SqlValue = string | number | null | Uint8Array
export type QueryRow = Record<string, SqlValue>

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

export interface PersistenceRpcRequest {
  type: typeof PERSISTENCE_RPC
  request: PersistenceOp
}

/**
 * Device-local persistence state the offscreen owner cannot reach itself.
 *
 * `backend` is the backend marker, `receipt` the migration receipt, and
 * `override` the operator switch that pins a profile to the legacy blob.
 */
export type PersistenceStateScope = "backend" | "receipt" | "override"

export interface PersistenceStateRequest {
  type: typeof PERSISTENCE_MARKER
  action: "get" | "set"
  scope: PersistenceStateScope
  value?: unknown
}

export type PersistenceRpcResponse =
  | { ok: true; result: unknown }
  | { ok: false; error: string }

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

// ---------------------------------------------------------------------------
// Blob codec. chrome.runtime messages are JSON-serialized on Chromium, so a
// Uint8Array (file attachment BLOBs) silently becomes {}. Binds and result
// rows are therefore encoded before crossing the messaging boundary and
// decoded on the other side. Worker<->host postMessage uses structured clone
// and keeps real Uint8Arrays.
// ---------------------------------------------------------------------------

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
