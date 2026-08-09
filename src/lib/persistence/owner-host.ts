import type { RuntimeSenderLike } from "@ollama-client/runtime-core/runtime-sender"
import { logger } from "@/lib/logger"
import {
  markOpfsBackend,
  type PersistenceBackend,
  readLegacyOverride,
  readMigrationReceipt,
  readPersistenceBackend,
  writeMigrationReceipt
} from "./backend"
import {
  describeMismatches,
  findMissingDurableTables,
  findTableCountMismatches,
  type IntegrityReport,
  isSoundDatabase,
  type TableCountMismatch
} from "./durable-tables"
import { isTrustedPersistenceSender } from "./host-authorization"
import type { ImportResult, SurveyResult } from "./protocol"
import {
  decodePersistenceWireOp,
  encodeRows,
  encodeValue,
  PERSISTENCE_ENSURE,
  PERSISTENCE_RPC,
  PersistenceEnsureRequestSchema,
  type PersistenceOp,
  PersistenceOpSchema,
  PersistenceRpcRequestSchema,
  type QueryRow
} from "./protocol"

/**
 * Host side of the production persistence topology. Runs in exactly one
 * context per browser session: the Chromium offscreen document
 * (src/entrypoints/persistence-host/) or the Firefox MV2 persistent
 * background page. Owns the only chat-db worker, answers persistence-rpc
 * runtime messages, and performs the one-time legacy-blob migration.
 */

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

/**
 * Turns a worker `error` event into something a bug report can act on.
 *
 * `ErrorEvent.error` is null for a worker that failed to load or parse at all —
 * which is the common case here, and the case where `message` and the source
 * location are the only evidence there is. Rejecting with a bare "worker
 * crashed" discarded every one of those fields, so the log named the symptom and
 * nothing else.
 */
export const describeWorkerError = (event: ErrorEvent | Event): string => {
  if (!(event instanceof ErrorEvent)) {
    return "Persistence worker crashed (no error detail available)"
  }
  const where = event.filename
    ? ` at ${event.filename}:${event.lineno}:${event.colno}`
    : ""
  const message =
    event.message ||
    (event.error instanceof Error ? event.error.message : "") ||
    "no message"
  return `Persistence worker crashed: ${message}${where}`
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
    worker.onerror = (event) => {
      const reason = describeWorkerError(event)
      logger.error(reason, "Persistence", {
        stack: event instanceof ErrorEvent ? event.error?.stack : undefined
      })
      // Drop the dead worker so the next call spawns a fresh one; OPFS holds
      // the durable state, so recovery is a respawn away.
      worker = null
      rejectAllPending(reason)
    }
    // A message the worker could not structured-clone never reaches onmessage,
    // so its request would hang in `pending` forever without this.
    worker.onmessageerror = (event) => {
      const reason = "Persistence worker could not deserialize a message"
      logger.error(reason, "Persistence", { data: event.data })
      rejectAllPending(reason)
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
  const validated = PersistenceOpSchema.parse(request)
  requestId += 1
  const id = requestId
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    if (validated.op === "importDb" && validated.bytes instanceof ArrayBuffer) {
      ensureWorker().postMessage({ id, request: validated }, [validated.bytes])
      return
    }
    ensureWorker().postMessage({ id, request: validated })
  })
}

/** One-time migration from the legacy IndexedDB blob */

let migrationPromise: Promise<void> | null = null

/**
 * Attempt the migration and report which backend the owner should serve from.
 *
 * A failure here is not fatal any more. It used to reject, every RPC with it,
 * and each client then opened its own in-context sql.js database against the
 * blob — which is how one profile ended up with as many writers as it had open
 * pages. The owner now serves the blob itself, so a failed migration downgrades
 * the topology instead of abandoning the request.
 */
const migrateLegacyBlobOnce = async (): Promise<{
  backend: PersistenceBackend
  integrity?: IntegrityReport
}> => {
  if (await readLegacyOverride()) {
    logger.warn(
      "Persistence legacy override is set; staying on the legacy blob",
      "Persistence"
    )
    // Recorded once, not on every boot: the override is a standing operator
    // decision, and an attempt counter climbing while nothing happens says
    // nothing.
    const previous = await readMigrationReceipt()
    if (previous?.outcome !== "skipped") {
      await writeMigrationReceipt({ outcome: "skipped" })
    }
    return { backend: "legacy" }
  }

  const backend = await readPersistenceBackend()
  if (backend === "opfs") return { backend: "opfs" }

  logger.info("Starting legacy-blob → OPFS migration", "Persistence")
  const { readLegacyBlobBytes } = await import("./legacy-blob-reader")
  const bytes = await readLegacyBlobBytes()

  if (!bytes || bytes.byteLength === 0) {
    // Fresh profile: nothing to migrate; the worker creates an empty schema.
    await callWorker({ op: "ping" })
    await markOpfsBackend({})
    await writeMigrationReceipt({ outcome: "fresh" })
    logger.info("No legacy blob; OPFS backend initialized fresh", "Persistence")
    return { backend: "opfs" }
  }

  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  ) as ArrayBuffer

  // Survey the source BEFORE the physical import — this is the verification
  // target, and it covers every durable table the blob has, not just the two
  // the chat list happens to read. The source blob itself is never modified or
  // deleted; it remains the rollback artifact.
  //
  // Measured by the worker, on the engine that will import it. A separate
  // reader could disagree with the importer about what the file contains, and
  // then verification would be comparing two engines rather than checking a
  // migration. It also means the blob is read by one SQLite, not two.
  const source = (await callWorker({
    op: "surveyDb",
    bytes: buffer
  })) as SurveyResult
  if (!isSoundDatabase(source.integrity)) {
    logger.warn(
      "Legacy blob failed integrity_check before import",
      "Persistence",
      {
        integrityCheck: source.integrity.integrityCheck
      }
    )
  }
  let imported: ImportResult | undefined
  let mismatches: TableCountMismatch[] = []
  try {
    imported = (await callWorker({
      op: "importDb",
      bytes: buffer
    })) as ImportResult

    mismatches = findTableCountMismatches(source.tables, imported.tables)
    if (mismatches.length > 0) {
      throw new Error(
        `Migration verification failed: ${describeMismatches(mismatches)}`
      )
    }

    // Row counts only prove that what the source had arrived. They say nothing
    // about a durable table the destination is supposed to have and does not —
    // that one is invisible to a comparison, because an absent source table is
    // skipped on the assumption a forward migration creates it.
    const missing = findMissingDurableTables(imported.tables)
    if (missing.length > 0) {
      throw new Error(
        `Migration verification failed: imported database is missing ${missing.join(", ")}`
      )
    }

    if (imported.integrity.foreignKeyViolations > 0) {
      // Recorded, not fatal. Orphan rows in a years-old blob are a data-quality
      // fact about the source; refusing to migrate would strand that history on
      // a backend that is being retired.
      logger.warn(
        "Migrated database has foreign-key violations",
        "Persistence",
        {
          foreignKeyViolations: imported.integrity.foreignKeyViolations
        }
      )
    }

    await markOpfsBackend({
      sourceCounts: { sessions: source.sessions, messages: source.messages }
    })
    await writeMigrationReceipt({
      outcome: "migrated",
      sourceSchemaVersion: source.schemaVersion,
      sourceBytes: bytes.byteLength,
      sourceCounts: source.tables,
      importedCounts: imported.tables,
      sourceIntegrity: source.integrity,
      importedIntegrity: imported.integrity,
      mismatches
    })
    logger.info(
      `Legacy blob migrated and verified: ${source.sessions} sessions, ${source.messages} messages`,
      "Persistence"
    )
    return { backend: "opfs" }
  } catch (error) {
    await writeMigrationReceipt({
      outcome: "failed",
      sourceSchemaVersion: source.schemaVersion,
      sourceBytes: bytes.byteLength,
      sourceCounts: source.tables,
      importedCounts: imported?.tables,
      sourceIntegrity: source.integrity,
      importedIntegrity: imported?.integrity,
      mismatches,
      failure: error instanceof Error ? error.message : String(error)
    })
    logger.error("Legacy-blob migration failed", "Persistence", { error })
    // The marker stays on "legacy" and the blob is untouched, so the owner can
    // serve from it. The source survey already measured this exact image; its
    // verdict is handed over so the legacy open does not rescan it.
    return { backend: "legacy", integrity: source.integrity }
  }
}

/**
 * Attempt the migration once, then put the owner on whichever backend it
 * settled on. Idempotent; safe to call on every host boot and before every RPC.
 *
 * A rejection here means the *owner* could not be brought up at all — the
 * worker never answered, the marker could not be read. A migration that fails
 * verification is not that: it resolves, on the legacy backend.
 */
export const ensureMigrated = (): Promise<void> => {
  if (!migrationPromise) {
    migrationPromise = (async () => {
      const outcome = await migrateLegacyBlobOnce()
      // Only the legacy direction is announced. "opfs" is the engine's default,
      // and re-announcing it on every boot would close and reopen a context
      // that is already correct.
      if (outcome.backend === "legacy") {
        await callWorker({
          op: "setBackend",
          backend: "legacy",
          integrity: outcome.integrity
        })
      }
    })().catch((error) => {
      migrationPromise = null
      logger.error("Persistence owner failed to start", "Persistence", {
        error
      })
      throw error
    })
  }
  return migrationPromise
}

/** RPC listener */

export const handlePersistenceHostMessage = (
  message: unknown,
  sender: RuntimeSenderLike,
  sendResponse: (response: unknown) => void
): boolean => {
  const extensionUrlPrefix = chrome.runtime.getURL("")
  const type = (message as { type?: string } | undefined)?.type
  if (type === PERSISTENCE_ENSURE) {
    if (
      !isTrustedPersistenceSender(
        sender,
        chrome.runtime.id,
        extensionUrlPrefix
      ) ||
      !PersistenceEnsureRequestSchema.safeParse(message).success
    ) {
      sendResponse({ ok: false, error: "Persistence request forbidden" })
      return true
    }
    // The host answering at all proves the owner exists.
    sendResponse({ ok: true })
    return true
  }
  if (type !== PERSISTENCE_RPC) return false
  if (
    !isTrustedPersistenceSender(sender, chrome.runtime.id, extensionUrlPrefix)
  ) {
    sendResponse({ ok: false, error: "Persistence request forbidden" })
    return true
  }
  const parsed = PersistenceRpcRequestSchema.safeParse(message)
  if (!parsed.success) {
    sendResponse({ ok: false, error: "Invalid persistence request" })
    return true
  }
  ;(async () => {
    try {
      await ensureMigrated()
      // Runtime messages JSON-serialize on Chromium: decode blob-encoded
      // binds/bytes into real Uint8Arrays before the worker sees them,
      // and encode binary results before sendResponse.
      const request = decodePersistenceWireOp(parsed.data.request)
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
}

export const registerPersistenceHost = (): void => {
  // In-process fast path for code running inside the host context itself
  // (the Firefox background page is both host and a heavy client).
  globalThis.__persistenceHostCall = async (request: PersistenceOp) => {
    await ensureMigrated()
    return callWorker(request)
  }

  void ensureMigrated().catch(() => {
    // Logged above. This is the owner failing to start, not a migration failing
    // verification — that resolves onto the legacy backend. Clients see their
    // requests reject until a later boot brings the owner up.
  })

  chrome.runtime.onMessage.addListener(handlePersistenceHostMessage)
}
