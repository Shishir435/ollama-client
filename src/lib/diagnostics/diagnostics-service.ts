import { browser, supportsDNR } from "@/lib/browser-api"
import { getSafeClientEnvironment } from "@/lib/client-environment"
import {
  localProviderOriginRuleMatches,
  readLocalProviderOriginRule
} from "@/lib/dnr-rules"
import { vectorDb } from "@/lib/embeddings/db"
import {
  type MigrationReceipt,
  readMigrationReceipt,
  readPersistenceBackend
} from "@/lib/persistence/backend"
import {
  rpcQuery,
  rpcRun,
  rpcTxBegin,
  rpcTxRollback
} from "@/lib/persistence/client"
import { resolveProviderBaseUrl } from "@/lib/providers/base-url"
import { ProviderManager } from "@/lib/providers/manager"
import { ProviderRpcService } from "@/lib/providers/provider-rpc-service"
import { ProviderId } from "@/lib/providers/types"
import { countMessages } from "@/lib/repositories/chat-history"
import type {
  DiagnosticStorageMigration,
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

/*
 * Typed structurally rather than as chrome.storage.StorageArea or the
 * polyfill's Storage.StorageArea: the two disagree on members this function
 * never touches (setAccessLevel, among others), and naming either one couples
 * a three-call round trip to whichever type package the caller happened to
 * come from.
 */
interface RoundTrippableStorage {
  get: (key: string) => Promise<Record<string, unknown>>
  set: (items: Record<string, unknown>) => Promise<void>
  remove: (key: string) => Promise<void>
}

const storageRoundTrip = async (
  area: RoundTrippableStorage
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
  const granted = await browser.permissions.getAll()
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

/**
 * Reduce a migration receipt to the evidence a maintainer needs and nothing
 * more.
 *
 * Row counts stay on the device. `messages: 39204` describes how much someone
 * has said, and a shortfall is diagnosable without it: `messages short by 5`
 * says a table lost five rows, which is the actionable half. An absolute pair
 * would have disclosed history volume out of a support report, which is the one
 * thing this summary exists to avoid.
 *
 * `integrity_check` output can be long on a damaged file, so each verdict is
 * clamped and the list of shortfalls is capped.
 */
const MAX_REPORTED_MISMATCHES = 10

export const summarizeMigrationReceipt = (
  receipt: MigrationReceipt | null
): DiagnosticStorageMigration | undefined => {
  if (!receipt) return undefined
  const verdict = (value?: string) =>
    value === undefined ? undefined : value.slice(0, 120)
  const mismatches = receipt.mismatches
    ?.slice(0, MAX_REPORTED_MISMATCHES)
    .map((mismatch) => {
      const delta = mismatch.source - mismatch.imported
      return delta > 0
        ? (`${mismatch.table} short by ${delta}` as const)
        : (`${mismatch.table} over by ${-delta}` as const)
    })
  return {
    outcome: receipt.outcome,
    attempts: receipt.attempts,
    recordedAt: receipt.recordedAt,
    extensionVersion: receipt.extensionVersion,
    sourceSchemaVersion: receipt.sourceSchemaVersion,
    sourceIntegrity: verdict(receipt.sourceIntegrity?.integrityCheck),
    importedIntegrity: verdict(receipt.importedIntegrity?.integrityCheck),
    foreignKeyViolations: receipt.importedIntegrity?.foreignKeyViolations,
    ...(mismatches && mismatches.length > 0 ? { mismatches } : {}),
    failure: receipt.failure ? receipt.failure.slice(0, 200) : undefined
  }
}

/**
 * The Origin rewrite is installed for the built-in local provider only.
 * Resolved here rather than imported from the background helper so a lib-level
 * diagnostic does not reach into the background layer — and the origin itself
 * never leaves this module, only the boolean "does the rule still describe it".
 */
const resolveLocalProviderOrigin = async (): Promise<string | undefined> => {
  try {
    const config = await ProviderManager.getProviderConfig(ProviderId.OLLAMA)
    return config ? new URL(resolveProviderBaseUrl(config)).origin : undefined
  } catch {
    return undefined
  }
}

/**
 * `capabilities()` already reports that the declarativeNetRequest API exists,
 * which is not the question a support report needs answered. Chromium's Origin
 * rewrite is exactly what makes `OLC-PROVIDER-UNREACHABLE` and
 * `OLC-CORS-BLOCKED` — the two codes that dominate reports — ambiguous:
 * "reachable: no" reads identically whether the local server is down or the
 * rule that lets the extension reach it was never installed. So read the rule
 * set, not the namespace.
 *
 * A rule installed for a base URL the user has since changed is the third
 * state, and the most confusing one in a report: API present, rule present,
 * requests still rejected.
 *
 * Firefox has no DNR equivalent and asks the user to configure the origin on
 * the server instead, so the rule's absence there is correct rather than a
 * defect — `unsupported`, never `fail`.
 */
const runDnrTest = async (): Promise<DiagnosticTestResult> => {
  if (!supportsDNR()) {
    return {
      id: "dnr_rules",
      status: "unsupported",
      durationMs: 0,
      metadata: { result: "not_applicable" }
    }
  }

  const result = await runTest("dnr_rules", async () => {
    const state = await readLocalProviderOriginRule()
    if (!state.installed) return { result: "missing" }
    const origin = await resolveLocalProviderOrigin()
    // No resolvable local provider means there is nothing for the rule to be
    // stale against; presence is all this can honestly claim.
    if (!origin) return { result: "installed" }
    return {
      result: localProviderOriginRuleMatches(state, origin)
        ? "installed"
        : "stale"
    }
  })

  if (result.status !== "pass") return result
  if (result.metadata?.result === "missing") {
    return { ...result, status: "action", code: "OLC-DNR-RULE-MISSING-001" }
  }
  if (result.metadata?.result === "stale") {
    return { ...result, status: "action", code: "OLC-DNR-RULE-STALE-001" }
  }
  return result
}

/** Comfortably older than the recovery sweep's staleness window. */
const CHECKPOINT_PROBE_AGE_MS = 24 * 60 * 60 * 1000

/**
 * Two mechanisms keep a turn recoverable across an MV3 worker restart, and both
 * fail silently: `tool_loop_runs` checkpoints (PR #193 tool loops) and the
 * interrupted-turn sweep that finalizes assistant rows left at `done = 0`.
 * Neither had an assertion, so schema or predicate drift would only ever
 * surface as turns that quietly never come back.
 *
 * Three claims, all against the real schema:
 *
 * 1. a checkpoint's `state` JSON survives a write/read round trip;
 * 2. a stale unfinished assistant turn is selected by the recovery predicate;
 * 3. the same turn is *not* selected while its session holds a live tool-loop
 *    checkpoint — the exclusion that stops recovery from finalizing a turn
 *    parked at an approval prompt.
 *
 * Runs inside a rolled-back transaction on synthetic ids, like
 * `chat_repository`, so it exercises real SQL without leaving a row behind.
 */
const runTurnCheckpointTest = async (): Promise<DiagnosticTestResult> =>
  runTest("turn_checkpoint", async () => {
    // Read the real counts before the probe rows exist, so they describe the
    // user's database rather than this test's scratch state.
    const [activeRuns, orphanedTurns] = await Promise.all([
      rpcQuery("SELECT COUNT(*) AS count FROM tool_loop_runs"),
      rpcQuery(
        `SELECT COUNT(*) AS count FROM messages
         WHERE role = 'assistant' AND done = 0`
      )
    ])

    const token = `diagnostic-${crypto.randomUUID()}`
    const orphanSession = `diagnostic-orphan-${crypto.randomUUID()}`
    const loopSession = `diagnostic-loop-${crypto.randomUUID()}`
    const requestId = `diagnostic-request-${crypto.randomUUID()}`
    const staleAt = Date.now() - CHECKPOINT_PROBE_AGE_MS
    const state = JSON.stringify({ iteration: 2, phase: "tools" })

    let began = false
    try {
      await rpcTxBegin(token)
      began = true

      for (const sessionId of [orphanSession, loopSession]) {
        await rpcRun(
          "INSERT INTO sessions (id, createdAt, updatedAt) VALUES (?, ?, ?)",
          [sessionId, staleAt, staleAt],
          token
        )
        await rpcRun(
          `INSERT INTO messages (sessionId, role, content, timestamp, done, updatedAt)
           VALUES (?, 'assistant', '', ?, 0, ?)`,
          [sessionId, staleAt, staleAt],
          token
        )
      }

      await rpcRun(
        `INSERT INTO tool_loop_runs
           (requestId, sessionId, model, mode, status, state, updatedAt)
         VALUES (?, ?, 'diagnostic', 'native', 'awaiting-confirmation', ?, ?)`,
        [requestId, loopSession, state, staleAt],
        token
      )

      const checkpoint = (
        await rpcQuery(
          "SELECT state, status FROM tool_loop_runs WHERE requestId = ?",
          [requestId],
          token
        )
      )[0]
      const restored =
        typeof checkpoint?.state === "string"
          ? (JSON.parse(checkpoint.state) as { iteration?: number })
          : undefined
      if (
        checkpoint?.status !== "awaiting-confirmation" ||
        restored?.iteration !== 2
      ) {
        throw new Error("checkpoint round trip mismatch")
      }

      // The shipped recovery predicate, narrowed to the probe sessions.
      const recoverable = await rpcQuery(
        `SELECT sessionId FROM messages
         WHERE role = 'assistant' AND done = 0
           AND (updatedAt IS NULL OR updatedAt < ?)
           AND sessionId IN (?, ?)
           AND sessionId NOT IN (
             SELECT sessionId FROM tool_loop_runs WHERE sessionId IS NOT NULL
           )`,
        [Date.now(), orphanSession, loopSession],
        token
      )
      if (
        recoverable.length !== 1 ||
        recoverable[0]?.sessionId !== orphanSession
      ) {
        throw new Error("interrupted-turn recovery predicate mismatch")
      }
    } finally {
      if (began) await rpcTxRollback(token)
    }

    return {
      activeRuns: Number(activeRuns[0]?.count ?? 0),
      orphanedTurns: Number(orphanedTurns[0]?.count ?? 0)
    }
  })

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
    runTest("sync_storage", () => storageRoundTrip(browser.storage.sync)),
    runTest("local_storage", () => storageRoundTrip(browser.storage.local)),
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
    runMigrationTest(),
    runDnrTest(),
    runTurnCheckpointTest()
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
    const migration = summarizeMigrationReceipt(await readMigrationReceipt())
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
        storage: {
          backend,
          messageCount,
          vectorCount,
          ...(migration ? { migration } : {})
        },
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
