import { browser } from "@/lib/browser-api"
import { PersistenceError, PersistenceNotDeliveredError } from "./errors"
import {
  decodeRows,
  decodeValue,
  encodeBind,
  PERSISTENCE_ENSURE,
  PERSISTENCE_RPC,
  PersistenceEnsureResponseSchema,
  type PersistenceOp,
  PersistenceRpcResponseSchema,
  type QueryRow,
  RETRYABLE_OPS,
  type RunResult
} from "./protocol"

/**
 * Client side of the persistence RPC. Every context that is not the owner —
 * sidepanel, options, popup, and the Chromium background service worker —
 * talks to the database exclusively through this module.
 *
 * In-process fast path: the owner host context (Firefox MV2 background page,
 * Chromium offscreen document) registers globalThis hooks; calls made from
 * inside the host skip runtime messaging entirely. The Chromium service
 * worker registers an ensure hook so it can create its own offscreen
 * document without messaging itself (runtime messages are never delivered
 * back to the sending context).
 */

const RPC_TIMEOUT_MS = 30_000

declare global {
  // eslint-disable-next-line no-var
  var __persistenceHostCall:
    | ((request: PersistenceOp) => Promise<unknown>)
    | undefined
  // eslint-disable-next-line no-var
  var __persistenceEnsureOwner: (() => Promise<void>) | undefined
}

const withTimeout = async <T>(
  work: Promise<T>,
  op: PersistenceOp["op"]
): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new PersistenceError({ op, reason: "timeout" })),
          RPC_TIMEOUT_MS
        )
      })
    ])
  } finally {
    clearTimeout(timer)
  }
}

/** Guarantees the owner host context exists (Chromium offscreen document /
 * Firefox background page). Exported because other work hosted by that same
 * document — durable file parsing — must not message a host that is not up. */
export const ensurePersistenceHost = async (): Promise<void> => {
  if (globalThis.__persistenceHostCall) return
  if (globalThis.__persistenceEnsureOwner) {
    await globalThis.__persistenceEnsureOwner()
    return
  }
  const rawResponse = await withTimeout(
    browser.runtime.sendMessage({ type: PERSISTENCE_ENSURE }),
    "ping"
  )
  const response = PersistenceEnsureResponseSchema.safeParse(rawResponse)
  if (!response.success) {
    throw new PersistenceError({ op: "ping", reason: "invalid-response" })
  }
  if (!response.data.ok) {
    throw new PersistenceError({
      op: "ping",
      reason: "owner-error",
      detail: response.data.error
    })
  }
}

const sendOnce = async (request: PersistenceOp): Promise<unknown> => {
  if (globalThis.__persistenceHostCall) {
    return globalThis.__persistenceHostCall(request)
  }
  try {
    await ensurePersistenceHost()
  } catch (error) {
    // Nothing was sent, so nothing ran — say so, rather than letting a caller
    // treat a cold owner like a write of unknown outcome.
    throw new PersistenceNotDeliveredError(request.op, error)
  }
  const wire =
    request.op === "query" || request.op === "run"
      ? { ...request, bind: encodeBind(request.bind) }
      : request.op === "importDb" && request.bytes instanceof ArrayBuffer
        ? { ...request, bytes: Array.from(new Uint8Array(request.bytes)) }
        : request
  const rawResponse = await withTimeout(
    browser.runtime.sendMessage({ type: PERSISTENCE_RPC, request: wire }),
    request.op
  )
  const response = PersistenceRpcResponseSchema.safeParse(rawResponse)
  if (!response.success) {
    throw new PersistenceError({
      op: request.op,
      reason: "invalid-response"
    })
  }
  if (!response.data.ok) {
    // The owner forwards SQLite's own message, which can name tables, columns
    // and statement fragments. It travels as `detail` for diagnostics rather
    // than as the error text every generic log line and error bubble prints.
    throw new PersistenceError({
      op: request.op,
      reason: "owner-error",
      detail: response.data.error
    })
  }
  return response.data.result
}

const send = async (request: PersistenceOp): Promise<unknown> => {
  try {
    return await sendOnce(request)
  } catch (error) {
    // Retry exactly once. Safe for ops that are idempotent by construction —
    // the owner may have just been recreated (worker crash, offscreen churn) —
    // and for any op the owner provably never received, because a request that
    // did not execute cannot be executed twice by repeating it.
    if (
      !RETRYABLE_OPS.has(request.op) &&
      !(error instanceof PersistenceNotDeliveredError)
    ) {
      throw error
    }
    return sendOnce(request)
  }
}

/** Typed surface used by the db facade */

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
  throw new PersistenceError({ op: "exportDb", reason: "invalid-response" })
}

export const rpcImportDb = async (
  bytes: Uint8Array
): Promise<import("./protocol").ImportResult> => {
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  ) as ArrayBuffer
  return (await send({
    op: "importDb",
    bytes: buffer
  })) as import("./protocol").ImportResult
}

export const rpcReset = (): Promise<unknown> => send({ op: "reset" })

export const rpcPing = (): Promise<unknown> => send({ op: "ping" })

/**
 * Make committed writes durable.
 *
 * Sent unconditionally rather than gated on the backend, because a client
 * cannot know which topology answered without an extra round trip of its own —
 * and the owner no-ops it on OPFS. It is called at unload, export and reset
 * boundaries, never on a hot path.
 */
export const rpcFlush = (): Promise<unknown> => send({ op: "flush" })

export {
  PersistenceError,
  type PersistenceFailureReason,
  PersistenceNotDeliveredError
} from "./errors"
