import { browser } from "@/lib/browser-api"
import {
  decodeRows,
  decodeValue,
  encodeBind,
  PERSISTENCE_ENSURE,
  PERSISTENCE_RPC,
  type PersistenceOp,
  type PersistenceRpcResponse,
  type QueryRow,
  RETRYABLE_OPS,
  type RunResult
} from "./protocol"

// Client side of the persistence RPC. Every context that is not the owner —
// sidepanel, options, popup, and the Chromium background service worker —
// talks to the database exclusively through this module.
//
// In-process fast path: the owner host context (Firefox MV2 background page,
// Chromium offscreen document) registers globalThis hooks; calls made from
// inside the host skip runtime messaging entirely. The Chromium service
// worker registers an ensure hook so it can create its own offscreen
// document without messaging itself (runtime messages are never delivered
// back to the sending context).

const RPC_TIMEOUT_MS = 30_000

declare global {
  // eslint-disable-next-line no-var
  var __persistenceHostCall:
    | ((request: PersistenceOp) => Promise<unknown>)
    | undefined
  // eslint-disable-next-line no-var
  var __persistenceEnsureOwner: (() => Promise<void>) | undefined
}

const withTimeout = async <T>(work: Promise<T>, label: string): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Persistence RPC timed out: ${label}`)),
          RPC_TIMEOUT_MS
        )
      })
    ])
  } finally {
    clearTimeout(timer)
  }
}

const ensureOwner = async (): Promise<void> => {
  if (globalThis.__persistenceHostCall) return
  if (globalThis.__persistenceEnsureOwner) {
    await globalThis.__persistenceEnsureOwner()
    return
  }
  const response = (await withTimeout(
    browser.runtime.sendMessage({ type: PERSISTENCE_ENSURE }),
    "ensure"
  )) as PersistenceRpcResponse | undefined
  if (!response) throw new Error("Persistence ensure message dropped")
  if (!response.ok) throw new Error(response.error)
}

const sendOnce = async (request: PersistenceOp): Promise<unknown> => {
  if (globalThis.__persistenceHostCall) {
    return globalThis.__persistenceHostCall(request)
  }
  await ensureOwner()
  const wire =
    request.op === "query" || request.op === "run"
      ? { ...request, bind: encodeBind(request.bind) }
      : request.op === "importDb" && request.bytes instanceof ArrayBuffer
        ? { ...request, bytes: Array.from(new Uint8Array(request.bytes)) }
        : request
  const response = (await withTimeout(
    browser.runtime.sendMessage({ type: PERSISTENCE_RPC, request: wire }),
    request.op
  )) as PersistenceRpcResponse | undefined
  if (!response) throw new Error("Persistence RPC message dropped")
  if (!response.ok) throw new Error(response.error)
  return response.result
}

const send = async (request: PersistenceOp): Promise<unknown> => {
  try {
    return await sendOnce(request)
  } catch (error) {
    // Retry exactly once, and only for ops that are safe to repeat: the
    // owner may have just been recreated (worker crash, offscreen churn).
    if (!RETRYABLE_OPS.has(request.op)) throw error
    return sendOnce(request)
  }
}

// ---------------------------------------------------------------------------
// Typed surface used by the db facade
// ---------------------------------------------------------------------------

export const rpcQuery = async (
  sql: string,
  bind?: PersistenceOp extends never ? never : import("./protocol").SqlValue[],
  tx?: string
): Promise<QueryRow[]> => {
  const rows = (await send({ op: "query", sql, bind, tx })) as unknown[]
  return globalThis.__persistenceHostCall
    ? (rows as QueryRow[])
    : decodeRows(rows)
}

export const rpcRun = async (
  sql: string,
  bind?: import("./protocol").SqlValue[],
  tx?: string
): Promise<RunResult> => (await send({ op: "run", sql, bind, tx })) as RunResult

export const rpcTxBegin = (token: string): Promise<unknown> =>
  send({ op: "txBegin", token })
export const rpcTxCommit = (token: string): Promise<unknown> =>
  send({ op: "txCommit", token })
export const rpcTxRollback = (token: string): Promise<unknown> =>
  send({ op: "txRollback", token })

export const rpcExportDb = async (): Promise<Uint8Array> => {
  const result = await send({ op: "exportDb" })
  if (result instanceof ArrayBuffer) return new Uint8Array(result)
  const decoded = decodeValue(result)
  if (decoded instanceof Uint8Array) return decoded
  throw new Error("exportDb returned an unexpected shape")
}

export const rpcImportDb = async (
  bytes: Uint8Array
): Promise<{ sessions: number; messages: number }> => {
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  ) as ArrayBuffer
  return (await send({ op: "importDb", bytes: buffer })) as {
    sessions: number
    messages: number
  }
}

export const rpcReset = (): Promise<unknown> => send({ op: "reset" })

export const rpcPing = (): Promise<unknown> => send({ op: "ping" })
