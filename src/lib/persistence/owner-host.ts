import { logger } from "@/lib/logger"
import { markOpfsBackend, readPersistenceBackend } from "./backend"
import {
  decodeBind,
  encodeRows,
  encodeValue,
  PERSISTENCE_ENSURE,
  PERSISTENCE_RPC,
  type PersistenceOp,
  type PersistenceRpcRequest,
  type QueryRow
} from "./protocol"

// Host side of the production persistence topology. Runs in exactly one
// context per browser session: the Chromium offscreen document
// (src/entrypoints/persistence-host/) or the Firefox MV2 persistent
// background page. Owns the only chat-db worker, answers persistence-rpc
// runtime messages, and performs the one-time legacy-blob migration.

let worker: Worker | null = null
let requestId = 0
const pending = new Map<
  number,
  { resolve: (value: unknown) => void; reject: (reason: Error) => void }
>()

const rejectAllPending = (reason: string): void => {
  for (const [id, entry] of pending) {
    pending.delete(id)
    entry.reject(new Error(reason))
  }
}

let wasmBinaryPromise: Promise<ArrayBuffer> | null = null
const getWasmBinary = (): Promise<ArrayBuffer> => {
  if (!wasmBinaryPromise) {
    const wasmUrl = chrome.runtime.getURL("assets/sqlite3.wasm")
    const attempt = fetch(wasmUrl)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Failed to fetch sqlite3.wasm: ${response.status}`)
        }
        return response.arrayBuffer()
      })
      .catch((error) => {
        // Never cache a rejection: the host lives for the whole browser
        // session and must retry on the next call.
        if (wasmBinaryPromise === attempt) wasmBinaryPromise = null
        throw error
      })
    wasmBinaryPromise = attempt
  }
  return wasmBinaryPromise
}

const ensureWorker = (): Worker => {
  if (!worker) {
    worker = new Worker(new URL("./chat-db-worker.ts", import.meta.url), {
      type: "module"
    })
    worker.onmessage = (
      event: MessageEvent<{
        id: number
        ok: boolean
        result?: unknown
        error?: string
      }>
    ) => {
      const entry = pending.get(event.data.id)
      if (!entry) return
      pending.delete(event.data.id)
      if (event.data.ok) entry.resolve(event.data.result)
      else entry.reject(new Error(event.data.error ?? "Unknown worker error"))
    }
    worker.onerror = () => {
      // Drop the dead worker so the next call spawns a fresh one; OPFS holds
      // the durable state, so recovery is a respawn away.
      worker = null
      rejectAllPending("Persistence worker crashed")
    }
    const spawned = worker
    void getWasmBinary()
      .then((binary) => {
        if (worker === spawned) {
          spawned.postMessage({ init: true, wasmBinary: binary })
        }
      })
      .catch((error) => {
        if (worker === spawned) {
          worker = null
          spawned.terminate()
          rejectAllPending(
            error instanceof Error ? error.message : String(error)
          )
        }
      })
  }
  return worker
}

export const callWorker = (request: PersistenceOp): Promise<unknown> => {
  requestId += 1
  const id = requestId
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    if (request.op === "importDb" && request.bytes instanceof ArrayBuffer) {
      ensureWorker().postMessage({ id, request }, [request.bytes])
      return
    }
    ensureWorker().postMessage({ id, request })
  })
}

// ---------------------------------------------------------------------------
// One-time migration from the legacy sql.js IndexedDB blob
// ---------------------------------------------------------------------------

let migrationPromise: Promise<void> | null = null

const migrateLegacyBlobOnce = async (): Promise<void> => {
  const backend = await readPersistenceBackend()
  if (backend === "opfs") return

  logger.info("Starting legacy-blob → OPFS migration", "Persistence")
  const { readLegacyBlobBytes, countLegacyRows } = await import(
    "./legacy-blob-reader"
  )
  const bytes = await readLegacyBlobBytes()

  if (!bytes || bytes.byteLength === 0) {
    // Fresh profile: nothing to migrate; the worker creates an empty schema.
    await callWorker({ op: "ping" })
    await markOpfsBackend({})
    logger.info("No legacy blob; OPFS backend initialized fresh", "Persistence")
    return
  }

  // Count the source rows BEFORE the physical import — this is the
  // verification target. The source blob itself is never modified or
  // deleted; it remains the rollback artifact.
  const sourceCounts = await countLegacyRows(bytes)
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  ) as ArrayBuffer

  const imported = (await callWorker({
    op: "importDb",
    bytes: buffer
  })) as { sessions: number; messages: number }

  if (
    imported.sessions !== sourceCounts.sessions ||
    imported.messages !== sourceCounts.messages
  ) {
    throw new Error(
      `Migration verification failed: sessions ${imported.sessions}/${sourceCounts.sessions}, messages ${imported.messages}/${sourceCounts.messages}`
    )
  }

  await markOpfsBackend({ sourceCounts })
  logger.info(
    `Legacy blob migrated and verified: ${sourceCounts.sessions} sessions, ${sourceCounts.messages} messages`,
    "Persistence"
  )
}

/** Idempotent; safe to call on every host boot. A failed attempt clears the
 * cached promise so the next boot (or next call) retries; the backend marker
 * only flips after verification succeeds. */
export const ensureMigrated = (): Promise<void> => {
  if (!migrationPromise) {
    migrationPromise = migrateLegacyBlobOnce().catch((error) => {
      migrationPromise = null
      logger.error("Legacy-blob migration failed", "Persistence", { error })
      throw error
    })
  }
  return migrationPromise
}

// ---------------------------------------------------------------------------
// RPC listener
// ---------------------------------------------------------------------------

export const registerPersistenceHost = (): void => {
  // In-process fast path for code running inside the host context itself
  // (the Firefox background page is both host and a heavy client).
  globalThis.__persistenceHostCall = async (request: PersistenceOp) => {
    await ensureMigrated()
    return callWorker(request)
  }

  void ensureMigrated().catch(() => {
    // Logged above; clients fall back to the legacy backend until a later
    // boot migrates successfully.
  })

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    const type = (message as { type?: string } | undefined)?.type
    if (type === PERSISTENCE_ENSURE) {
      // The host answering at all proves the owner exists.
      sendResponse({ ok: true })
      return true
    }
    const rpc = message as PersistenceRpcRequest | undefined
    if (rpc?.type !== PERSISTENCE_RPC) return false
    ;(async () => {
      try {
        await ensureMigrated()
        // Runtime messages JSON-serialize on Chromium: decode blob-encoded
        // binds/bytes into real Uint8Arrays before the worker sees them,
        // and encode binary results before sendResponse.
        const request = { ...rpc.request } as PersistenceOp
        if (request.op === "query" || request.op === "run") {
          request.bind = decodeBind(request.bind as unknown[])
        }
        if (
          request.op === "importDb" &&
          Array.isArray(request.bytes as unknown)
        ) {
          request.bytes = Uint8Array.from(request.bytes as unknown as number[])
            .buffer as ArrayBuffer
        }
        const result = await callWorker(request)
        if (request.op === "query") {
          sendResponse({ ok: true, result: encodeRows(result as QueryRow[]) })
          return
        }
        if (result instanceof ArrayBuffer) {
          sendResponse({
            ok: true,
            result: encodeValue(new Uint8Array(result))
          })
          return
        }
        sendResponse({ ok: true, result })
      } catch (error) {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        })
      }
    })()
    return true
  })
}
