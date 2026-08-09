/** Experimental ensure message for the isolated single-owner OPFS spike. */
export const SPIKE_OWNER_ENSURE = "spike-owner-ensure"
export const SPIKE_OWNER_CLOSE = "spike-owner-close"
export const SPIKE_OWNER_BG_WRITE = "spike-owner-bg-write"
export const SPIKE_OWNER_RPC = "spike-owner-rpc"

export type OwnerOp =
  | "ownerInfo"
  | "terminateWorker"
  | "append"
  | "counts"
  | "upsertCheckpoint"
  | "readCheckpoint"
  | "checkpointSummary"
  | "beginHang"
  | "exportDb"
  | "reset"

export interface ExportDbResult {
  exportedBytes: number
  // Row count observed by importing the exported bytes into a scratch file —
  // proves the export is a consistent, openable database (gate 7).
  verifiedTotal: number
}

export interface OwnerRpcMessage {
  type: typeof SPIKE_OWNER_RPC
  op: OwnerOp
  payload?: unknown
}

export interface AppendPayload {
  writer: string
  seq: number
}

export interface CheckpointPayload {
  requestId: string
  state: string
}

export interface CountsResult {
  total: number
  byWriter: Record<string, number>
}

export interface OwnerInfoResult {
  ownerId: string
  workerGeneration: number
}

export type OwnerRpcResponse =
  | { ok: true; result: unknown }
  | { ok: false; error: string }
