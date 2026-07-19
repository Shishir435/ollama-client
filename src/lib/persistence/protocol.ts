// Production persistence RPC: wire types between database clients (sidepanel,
// options, background) and the single database owner (Chromium offscreen
// document / Firefox MV2 background page). Section 9.4 decision record:
// official sqlite-wasm behind the opfs-sahpool VFS, one owner per browser
// session, every other context a stateless RPC client.

export const PERSISTENCE_RPC = "persistence-rpc"
export const PERSISTENCE_ENSURE = "persistence-ensure"

export type SqlValue = string | number | null | Uint8Array
export type QueryRow = Record<string, SqlValue>

export type PersistenceOp =
  | { op: "query"; sql: string; bind?: SqlValue[]; tx?: string }
  | { op: "run"; sql: string; bind?: SqlValue[]; tx?: string }
  | { op: "txBegin"; token: string }
  | { op: "txCommit"; token: string }
  | { op: "txRollback"; token: string }
  | { op: "exportDb" }
  | { op: "importDb"; bytes: ArrayBuffer }
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
}

export interface PersistenceRpcRequest {
  type: typeof PERSISTENCE_RPC
  request: PersistenceOp
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
  "ping"
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
