import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ImportResult, SurveyResult } from "../protocol"

// Migration verification and its receipt. Each test re-imports owner-host,
// because `ensureMigrated` memoizes the attempt for the life of the module —
// the same reason a real owner runs it once per host.

const legacyBlob = vi.hoisted(() => ({
  readLegacyBlobBytes: vi.fn()
}))
vi.mock("../legacy-blob-reader", () => legacyBlob)

const importResults: ImportResult[] = []
/** Queued `surveyDb` answers; falls back to a sound survey of the fixture. */
const surveyResults: SurveyResult[] = []

/** Every op the host sent the worker, in order. */
const workerOps: { op?: string; backend?: string }[] = []

class StubWorker {
  onmessage: ((event: { data: unknown }) => void) | null = null
  onerror: ((event: unknown) => void) | null = null
  onmessageerror: ((event: unknown) => void) | null = null

  postMessage(payload: {
    id?: number
    request?: { op?: string; backend?: string }
  }) {
    if (typeof payload.id !== "number") return
    const { id } = payload
    const op = payload.request?.op
    if (payload.request) workerOps.push(payload.request)
    queueMicrotask(() => {
      if (op === "surveyDb") {
        this.onmessage?.({
          data: {
            id,
            ok: true,
            result: surveyResults.shift() ?? sourceSurvey
          }
        })
        return
      }
      if (op === "importDb") {
        const result = importResults.shift()
        this.onmessage?.({
          data: result
            ? { id, ok: true, result }
            : { id, ok: false, error: "no stubbed import result" }
        })
        return
      }
      this.onmessage?.({ data: { id, ok: true, result: "pong" } })
    })
  }

  terminate() {}
}

const BACKEND_KEY = "persistence_backend_v1"
const RECEIPT_KEY = "persistence_migration_receipt_v1"
const OVERRIDE_KEY = "persistence_legacy_override_v1"

const store = new Map<string, unknown>()

const sourceSurvey = {
  sessions: 2,
  messages: 9,
  tables: { sessions: 2, messages: 9, prompt_templates: 7 },
  schemaVersion: 11,
  integrity: { integrityCheck: "ok", foreignKeyViolations: 0 }
}

/** Every durable table, since SCHEMA_SQL creates them all on open. Tables the
 * source never had arrive empty, which is correct rather than data loss. */
const importedTables = {
  sessions: 2,
  messages: 9,
  prompt_templates: 7,
  files: 0,
  kv_store: 0,
  tool_loop_runs: 0,
  turn_runs: 0,
  ingestion_runs: 0,
  model_pull_runs: 0,
  agent_runs: 0,
  agent_steps: 0,
  vector_cleanup_receipts: 0,
  chunk_feedback: 0
}

const importResult = (overrides: Partial<ImportResult> = {}): ImportResult => ({
  sessions: 2,
  messages: 9,
  tables: importedTables,
  integrity: { integrityCheck: "ok", foreignKeyViolations: 0 },
  ...overrides
})

const receipt = (): Record<string, unknown> =>
  (store.get(RECEIPT_KEY) ?? {}) as Record<string, unknown>

const loadHost = async () => {
  vi.resetModules()
  return import("../owner-host")
}

describe("legacy-blob migration verification", () => {
  beforeEach(() => {
    store.clear()
    importResults.length = 0
    surveyResults.length = 0
    workerOps.length = 0
    legacyBlob.readLegacyBlobBytes.mockReset()
    legacyBlob.readLegacyBlobBytes.mockResolvedValue(
      Uint8Array.from([1, 2, 3, 4])
    )
    vi.mocked(chrome.storage.local.get as never as ReturnType<typeof vi.fn>)
      .mockReset()
      .mockImplementation(async (key: string) =>
        store.has(key) ? { [key]: store.get(key) } : {}
      )
    vi.mocked(chrome.storage.local.set as never as ReturnType<typeof vi.fn>)
      .mockReset()
      .mockImplementation(async (items: Record<string, unknown>) => {
        for (const [key, value] of Object.entries(items)) store.set(key, value)
      })
    vi.stubGlobal("Worker", StubWorker)
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(8))
      })
    )
  })

  it("flips the marker and records a receipt when every table survives", async () => {
    importResults.push(importResult())
    const { ensureMigrated } = await loadHost()

    await expect(ensureMigrated()).resolves.toBeUndefined()

    expect(store.get(BACKEND_KEY)).toMatchObject({ backend: "opfs" })
    expect(receipt()).toMatchObject({
      outcome: "migrated",
      attempts: 1,
      sourceSchemaVersion: 11,
      sourceBytes: 4,
      sourceCounts: sourceSurvey.tables,
      importedIntegrity: { integrityCheck: "ok" },
      mismatches: []
    })
  })

  it("fails and stays on legacy when a table the source had arrives short", async () => {
    // prompt_templates is the case the old sessions/messages-only check could
    // not see: chats look complete while the user's templates are gone.
    importResults.push(
      importResult({
        tables: { ...importedTables, prompt_templates: 6 }
      })
    )
    const { ensureMigrated } = await loadHost()

    // Resolves rather than rejects. A verification failure is not the owner
    // failing to start: the marker stays on "legacy", the blob is untouched,
    // and the owner is told to serve from it. It used to reject and take every
    // RPC with it, which left each client to open its own database against the
    // same blob.
    await expect(ensureMigrated()).resolves.toBeUndefined()

    expect(store.has(BACKEND_KEY)).toBe(false)
    expect(workerOps).toContainEqual(
      expect.objectContaining({ op: "setBackend", backend: "legacy" })
    )
    expect(receipt()).toMatchObject({
      outcome: "failed",
      failure: expect.stringContaining("prompt_templates short by 1"),
      mismatches: [{ table: "prompt_templates", source: 7, imported: 6 }]
    })
  })

  it("hands the source's integrity verdict to the legacy open", async () => {
    // The survey already scanned this exact image. Passing the verdict along is
    // what stops the legacy open repeating a full scan on the same boot.
    surveyResults.push({
      ...sourceSurvey,
      integrity: {
        integrityCheck: "Page 4 is never used",
        foreignKeyViolations: 0
      }
    })
    const { ensureMigrated } = await loadHost()

    await expect(ensureMigrated()).resolves.toBeUndefined()

    expect(workerOps).toContainEqual(
      expect.objectContaining({
        op: "setBackend",
        backend: "legacy",
        integrity: {
          integrityCheck: "Page 4 is never used",
          foreignKeyViolations: 0
        }
      })
    )
  })

  it("records an import failure the worker reported", async () => {
    const { ensureMigrated } = await loadHost()

    await expect(ensureMigrated()).resolves.toBeUndefined()

    expect(store.has(BACKEND_KEY)).toBe(false)
    expect(receipt()).toMatchObject({
      outcome: "failed",
      importedCounts: undefined,
      failure: "no stubbed import result"
    })
  })

  it("counts attempts across boots", async () => {
    importResults.push(
      importResult({ tables: { ...importedTables, messages: 8 } }),
      importResult()
    )

    const first = await loadHost()
    await expect(first.ensureMigrated()).resolves.toBeUndefined()
    expect(receipt()).toMatchObject({ outcome: "failed", attempts: 1 })

    const second = await loadHost()
    await expect(second.ensureMigrated()).resolves.toBeUndefined()
    expect(receipt()).toMatchObject({ outcome: "migrated", attempts: 2 })
  })

  it("migrates despite foreign-key violations, and records them", async () => {
    // Orphan rows in a years-old blob are a fact about the source. Refusing to
    // migrate would strand that history on the backend being retired.
    importResults.push(
      importResult({
        integrity: { integrityCheck: "ok", foreignKeyViolations: 3 }
      })
    )
    const { ensureMigrated } = await loadHost()

    await expect(ensureMigrated()).resolves.toBeUndefined()

    expect(store.get(BACKEND_KEY)).toMatchObject({ backend: "opfs" })
    expect(receipt()).toMatchObject({
      outcome: "migrated",
      importedIntegrity: { foreignKeyViolations: 3 }
    })
  })

  it("skips the migration while the operator override is set", async () => {
    store.set(OVERRIDE_KEY, true)
    const { ensureMigrated } = await loadHost()

    await expect(ensureMigrated()).resolves.toBeUndefined()

    expect(store.has(BACKEND_KEY)).toBe(false)
    expect(legacyBlob.readLegacyBlobBytes).not.toHaveBeenCalled()
    expect(receipt()).toMatchObject({ outcome: "skipped" })
  })

  it("records the skip once instead of on every boot", async () => {
    store.set(OVERRIDE_KEY, true)
    const first = await loadHost()
    await first.ensureMigrated()
    const second = await loadHost()
    await second.ensureMigrated()

    expect(receipt()).toMatchObject({ outcome: "skipped", attempts: 1 })
  })
})

describe("operator override", () => {
  beforeEach(() => {
    store.clear()
    vi.mocked(chrome.storage.local.get as never as ReturnType<typeof vi.fn>)
      .mockReset()
      .mockImplementation(async (key: string) =>
        store.has(key) ? { [key]: store.get(key) } : {}
      )
    vi.mocked(chrome.storage.local.set as never as ReturnType<typeof vi.fn>)
      .mockReset()
      .mockImplementation(async (items: Record<string, unknown>) => {
        for (const [key, value] of Object.entries(items)) store.set(key, value)
      })
  })

  it("returns a migrated profile to the legacy blob", async () => {
    const backend = await import("../backend")
    backend.invalidateBackendCache()
    store.set(BACKEND_KEY, { backend: "opfs" })

    await expect(backend.readPersistenceBackend()).resolves.toBe("opfs")

    await backend.setLegacyOverride(true)
    // Read again in the same context: a switch that only takes effect after a
    // reload is not a recovery path.
    await expect(backend.readPersistenceBackend()).resolves.toBe("legacy")
    expect(store.get(OVERRIDE_KEY)).toBe(true)

    await backend.setLegacyOverride(false)
    await expect(backend.readPersistenceBackend()).resolves.toBe("opfs")
  })

  it("stays off when the override read fails", async () => {
    const backend = await import("../backend")
    backend.invalidateBackendCache()
    vi.mocked(
      chrome.storage.local.get as never as ReturnType<typeof vi.fn>
    ).mockRejectedValue(new Error("storage gone"))

    // A storage glitch must not send a migrated profile back to a stale blob.
    await expect(backend.readPersistenceBackend()).resolves.toBe("legacy")
    await expect(backend.readLegacyOverride()).resolves.toBe(false)
  })
})
