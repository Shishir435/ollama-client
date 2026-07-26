import { vectorDb } from "@/lib/embeddings/db"
import { getSafeClientEnvironment } from "@/lib/error-report"
import { readPersistenceBackend } from "@/lib/persistence/backend"
import { rpcQuery, rpcTxBegin, rpcTxRollback } from "@/lib/persistence/client"
import { ProviderManager } from "@/lib/providers/manager"
import { ProviderRpcService } from "@/lib/providers/provider-rpc-service"
import { countMessages } from "@/lib/repositories/chat-history"
import type {
  DiagnosticsGetBundleResult,
  DiagnosticsRunResult,
  DiagnosticTestResult
} from "@/protocol/diagnostics-rpc"

import {
  clearDiagnosticEvents,
  getDiagnosticEvents,
  recordDiagnosticEvent
} from "./diagnostic-recorder"

const elapsed = (startedAt: number) =>
  Math.max(0, performance.now() - startedAt)

const runTest = async (
  id: string,
  test: () => Promise<
    Record<string, string | number | boolean | null> | undefined
  >
): Promise<DiagnosticTestResult> => {
  const startedAt = performance.now()
  try {
    const metadata = await test()
    return {
      id,
      status: "pass",
      durationMs: elapsed(startedAt),
      ...(metadata && { metadata })
    }
  } catch {
    return {
      id,
      status: "fail",
      durationMs: elapsed(startedAt),
      code: `OLC-${id.replaceAll("_", "-").toUpperCase()}-001`
    }
  }
}

const storageRoundTrip = async (
  area: chrome.storage.StorageArea
): Promise<undefined> => {
  const key = `diagnostic-self-test-${crypto.randomUUID()}`
  const value = crypto.randomUUID()
  try {
    await area.set({ [key]: value })
    const read = await area.get(key)
    if (read[key] !== value) throw new Error("storage roundtrip mismatch")
  } finally {
    await area.remove(key)
  }
  return undefined
}

const capabilities = () => ({
  tabs: Boolean(chrome.tabs),
  permissions: Boolean(chrome.permissions),
  sessions: Boolean(chrome.sessions),
  declarativeNetRequest: Boolean(chrome.declarativeNetRequest),
  offscreen: Boolean(chrome.offscreen)
})

const permissions = async (): Promise<Record<string, boolean>> => {
  if (!chrome.permissions?.getAll) return {}
  const granted = await chrome.permissions.getAll()
  const names = new Set(granted.permissions ?? [])
  return {
    tabs: names.has("tabs"),
    sessions: names.has("sessions"),
    history: names.has("history"),
    bookmarks: names.has("bookmarks"),
    notifications: names.has("notifications")
  }
}

const runMigrationTest = async (): Promise<DiagnosticTestResult> => {
  const result = await runTest("migration", async () => ({
    result: await readPersistenceBackend()
  }))
  if (result.status === "pass" && result.metadata?.result === "legacy") {
    return {
      ...result,
      status: "action",
      code: "OLC-STORAGE-MIGRATION-001"
    }
  }
  return result
}

const executeSelfTests = async (
  signal?: AbortSignal
): Promise<DiagnosticTestResult[]> => {
  const tests = await Promise.all([
    runTest("runtime_version", async () => {
      const version = chrome.runtime.getManifest().version
      if (!version) throw new Error("missing version")
      return { result: "available" }
    }),
    runTest("browser_apis", async () => ({
      count: Object.values(capabilities()).filter(Boolean).length
    })),
    runTest("permissions", async () => ({
      count: Object.values(await permissions()).filter(Boolean).length
    })),
    runTest("sync_storage", () => storageRoundTrip(chrome.storage.sync)),
    runTest("local_storage", () => storageRoundTrip(chrome.storage.local)),
    runTest("chat_repository", async () => {
      const token = `diagnostic-${crypto.randomUUID()}`
      let began = false
      try {
        await rpcTxBegin(token)
        began = true
        const rows = await rpcQuery("SELECT 1 AS ok", undefined, token)
        if (rows[0]?.ok !== 1) throw new Error("transaction smoke mismatch")
      } finally {
        if (began) await rpcTxRollback(token)
      }
      const count = await countMessages()
      return { count }
    }),
    runTest("vector_store", async () => ({
      count: await vectorDb.vectors.count()
    })),
    runTest("provider_discovery", async () => {
      const result = await ProviderRpcService.listModels(
        { enabledOnly: true },
        signal
      )
      return {
        count: result.models.length,
        status: result.failures.length > 0 ? "partial" : "pass"
      }
    }),
    runMigrationTest()
  ])
  signal?.throwIfAborted()
  // Recorded once per real execution, never on a shared/cached result, so
  // displaying failures cannot flood the ring buffer that explains them.
  await recordDiagnosticEvent({
    level: tests.every((test) => test.status === "pass") ? "info" : "warn",
    code: "DIAGNOSTICS_SELF_TEST_COMPLETED",
    operation: "diagnostics.run",
    surface: "background",
    metadata: {
      count: tests.length,
      result: tests.some((test) => test.status === "fail")
        ? "failure"
        : tests.some((test) => test.status === "action")
          ? "action"
          : "pass"
    }
  })
  return tests
}

/**
 * The suite is not free: it opens a repository transaction, round-trips both
 * storage areas, and performs provider model discovery over the network. A chat
 * error bubble prepares a bundle on mount, and the message list is virtualized,
 * so N visible failures used to mean N full suites — including N network probes
 * and N recorded events, which diluted the very ring buffer the events explain.
 *
 * Results are therefore shared for a short window. Short enough that a user who
 * changes a setting and re-runs from the diagnostics screen sees fresh truth
 * (that path passes `force`), long enough that painting a screenful of failures
 * costs one suite.
 */
const SELF_TEST_TTL_MS = 60_000

type SharedRun = {
  promise: Promise<DiagnosticTestResult[]>
  controller: AbortController
  waiters: number
  seq: number
}

let selfTestCache:
  | { at: number; seq: number; tests: DiagnosticTestResult[] }
  | undefined
let sharedRun: SharedRun | undefined
let runSeq = 0

const rejectOnAbort = (signal: AbortSignal): Promise<never> =>
  new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), {
      once: true
    })
  })

/**
 * Await the shared run while keeping this caller's cancellation meaningful: an
 * aborting caller stops waiting immediately, and the underlying work is only
 * cancelled once every interested caller has abandoned it. Preserves the
 * end-to-end RPC cancellation path without letting one client's timeout kill
 * another client's in-flight suite.
 */
const joinSharedRun = async (
  run: SharedRun,
  signal?: AbortSignal
): Promise<DiagnosticTestResult[]> => {
  run.waiters += 1
  if (!signal) return run.promise
  const abandon = () => {
    run.waiters -= 1
    if (run.waiters <= 0) run.controller.abort(signal.reason)
  }
  signal.addEventListener("abort", abandon, { once: true })
  try {
    return await Promise.race([run.promise, rejectOnAbort(signal)])
  } finally {
    signal.removeEventListener("abort", abandon)
  }
}

/**
 * Begin a fresh execution and make it the run new callers attach to.
 *
 * A run that finishes out of order must not publish stale results, which is
 * possible once a forced run overtakes an in-flight one: results are only cached
 * when they come from a newer execution than whatever is cached.
 */
const startSharedRun = (): SharedRun => {
  const controller = new AbortController()
  const run: SharedRun = {
    controller,
    waiters: 0,
    seq: ++runSeq,
    promise: undefined as unknown as Promise<DiagnosticTestResult[]>
  }
  run.promise = executeSelfTests(controller.signal)
    .then((tests) => {
      if (!selfTestCache || run.seq > selfTestCache.seq) {
        selfTestCache = { at: Date.now(), seq: run.seq, tests }
      }
      return tests
    })
    .finally(() => {
      if (sharedRun === run) sharedRun = undefined
    })
  sharedRun = run
  return run
}

export const DiagnosticsService = {
  /** Exposed for tests; production callers get the TTL-shared path. */
  __resetSelfTestCache() {
    selfTestCache = undefined
    sharedRun = undefined
  },

  async run(
    signal?: AbortSignal,
    options?: { force?: boolean }
  ): Promise<DiagnosticsRunResult> {
    // A forced run means "measure the state I am looking at now", so it must
    // neither read the cache nor attach to work that started before the caller
    // asked — an automatic bundle request already in flight was measuring the
    // configuration from before the user's change. It still becomes the run that
    // later callers share, so forcing does not multiply concurrent suites.
    //
    // Deliberately not coalesced with a concurrent forced run. Comparing start
    // times to decide "is that run fresh enough for me" cannot be made exact:
    // wall-clock granularity makes a run that started just before the request
    // indistinguishable from one that started just after, and freshness really
    // depends on whether config changed in between, which is not tracked. The
    // only caller that can force is the "Run self-tests" button, which is
    // disabled while running, so the duplication this would save is two open
    // options pages measuring at different times — which *should* measure twice.
    // If this ever needs coalescing, gate it on a config-mutation counter, not
    // on a clock.
    if (options?.force) {
      return { tests: await joinSharedRun(startSharedRun(), signal) }
    }
    if (selfTestCache && Date.now() - selfTestCache.at < SELF_TEST_TTL_MS) {
      signal?.throwIfAborted()
      return { tests: selfTestCache.tests }
    }
    return { tests: await joinSharedRun(sharedRun ?? startSharedRun(), signal) }
  },

  async getBundle(
    signal?: AbortSignal,
    sessionId?: string
  ): Promise<DiagnosticsGetBundleResult> {
    const [
      providers,
      events,
      selfTests,
      permissionState,
      messageCount,
      vectorCount
    ] = await Promise.all([
      ProviderManager.getProviders(),
      getDiagnosticEvents(),
      this.run(signal).then((result) => result.tests),
      permissions(),
      countMessages(),
      vectorDb.vectors.count()
    ])
    signal?.throwIfAborted()
    const backend = await readPersistenceBackend()
    const environment = getSafeClientEnvironment()
    return {
      bundle: {
        format: "ollama-client-support-v1",
        createdAt: Date.now(),
        appVersion: chrome.runtime.getManifest().version,
        browserFamily: environment.browser,
        osFamily: environment.os,
        capabilities: capabilities(),
        permissions: permissionState,
        providers: providers.map((provider) => ({
          profile: String(provider.serviceProfile ?? "generic"),
          wire: String(provider.type),
          enabled: provider.enabled
        })),
        storage: { backend, messageCount, vectorCount },
        events: sessionId
          ? events.filter((event) => event.sessionId === sessionId)
          : events,
        selfTests
      }
    }
  },

  async clear() {
    await clearDiagnosticEvents()
    return { cleared: true as const }
  }
}
