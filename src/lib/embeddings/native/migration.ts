import { browser } from "@/lib/browser-api"
import { readSetting, writeSetting } from "@/lib/storage/setting-access"
import { SETTINGS } from "@/lib/storage/settings"
import { vectorDb } from "../db"
import {
  generateEmbeddingWithStrategy,
  resolveEmbeddingPlan
} from "../embedding-strategy"
import { normalizeVector } from "../math"
import type { VectorDocument } from "../types"
import { encodeVectorDocument } from "../vector-codec"
import {
  applyVectorStorageDelta,
  emptyVectorStorageStats,
  recordVectorStorageChange
} from "../vector-storage-stats"
import { generateBundledEmbedding } from "./client"
import { BUNDLED_MODEL, BUNDLED_PROVIDER } from "./constants"
import { type NativeIndexState, readNativeIndexState } from "./state"

/** Retain a fingerprint rather than a second copy of content users may later delete. */
/** Rows read per page while reconciling, so a large corpus is never held whole. */
const RECONCILE_PAGE_ROWS = 500

const fingerprint = async (document: VectorDocument): Promise<string> => {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(sourceKey(document))
  )
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("")
}

export const nativeEmbeddingStatus = async () => {
  const { mode, migration, current, total } = await readNativeIndexState()
  return {
    mode,
    dismissed: await readSetting(SETTINGS.BUNDLED_EMBEDDING_NOTICE_DISMISSED),
    migration,
    current,
    total
  }
}

type NativeEmbeddingAction =
  | "start"
  | "step"
  | "resume"
  | "cancel"
  | "keep"
  | "dismiss"
  | "external"

/** Serialize commands from multiple open settings pages; batches survive worker restarts. */
let commands: Promise<unknown> = Promise.resolve()
let activeCommand: AbortController | undefined
/** A cancellation invalidates queued commands before they can acquire the active slot. */
let commandEpoch = 0
/** Counts snapshot resets, so a failure is never recorded against a rebuild started after it. */
let snapshotEpoch = 0
const enqueue = <T>(
  task: (signal: AbortSignal) => Promise<T>,
  signal?: AbortSignal
) => {
  const epoch = commandEpoch
  const work = commands
    .catch(() => undefined)
    .then(async () => {
      if (epoch !== commandEpoch)
        throw new DOMException("Cancelled", "AbortError")
      const run = new AbortController()
      const abort = () => run.abort(signal?.reason)
      signal?.addEventListener("abort", abort, { once: true })
      if (signal?.aborted) abort()
      activeCommand = run
      try {
        return await task(run.signal)
      } finally {
        signal?.removeEventListener("abort", abort)
        if (activeCommand === run) activeCommand = undefined
      }
    })
  commands = work
  return work
}
/**
 * The step-level primitive the driver loop and tests use. It never drives a
 * rebuild itself: production starts go through
 * `requestNativeEmbeddingCommand`, which drives the rebuild it starts and
 * recovers the one it replaced when a start fails.
 */
export const nativeEmbeddingCommand = (
  action: NativeEmbeddingAction,
  signal?: AbortSignal
) => {
  if (action === "cancel" || action === "keep") {
    commandEpoch++
    activeCommand?.abort()
    driver?.abort()
  }
  /**
   * A new snapshot supersedes the loop driving the old one. Left running, a
   * loop whose batch failed while this command waited skipped its failure
   * mark (the snapshot it failed against is gone) and still held the driver
   * slot when the new rebuild asked for one, so nothing drove it: "building",
   * total 0, until the next restart.
   */
  if (action === "start" || action === "external") driver?.abort()
  return enqueue((run) => runCommand(action, run), signal)
}

/**
 * The background owns the batch loop, so closing the dialog or the side panel
 * never stalls a rebuild. Chromium ends a worker after 30s without extension
 * API activity, and a provider fetch is not such activity; the heartbeat keeps
 * the worker alive while batches run. A worker lost anyway resumes at startup.
 */
let driver: AbortController | undefined
const HEARTBEAT_MS = 20_000

export const driveNativeMigration = () => {
  if (driver && !driver.signal.aborted) return
  const run = new AbortController()
  driver = run
  const heartbeat = setInterval(() => {
    void browser.runtime.getPlatformInfo?.().catch(() => undefined)
  }, HEARTBEAT_MS)
  void (async () => {
    let epoch = snapshotEpoch
    try {
      while (!run.signal.aborted) {
        epoch = snapshotEpoch
        const status = await nativeEmbeddingCommand("step", run.signal)
        if (status.migration !== "building") return
      }
    } catch {
      /** Only our own cancel is silent: a provider's AbortError still stops the rebuild. */
      if (!run.signal.aborted)
        await enqueue(() => markMigrationFailed(epoch)).catch(() => undefined)
    } finally {
      clearInterval(heartbeat)
      if (driver === run) driver = undefined
    }
  })()
}

/** A failed rebuild waits for the user; retrying it every boot would only fail again. */
const markMigrationFailed = async (epoch: number) => {
  if (epoch !== snapshotEpoch) return
  const state = await readNativeIndexState()
  if (state.migration === "building")
    await vectorDb.embeddingState.put({ ...state, failed: true })
}

const withoutFailure = ({ failed: _failed, ...state }: NativeIndexState) =>
  state

/**
 * RPC entry: commands answer immediately while the rebuild continues in the
 * background. Starting commands ignore the page's signal, because a page that
 * closes or times out during a long snapshot is not a cancellation; only
 * `cancel` and `keep` stop a rebuild.
 */
export const requestNativeEmbeddingCommand = async (
  action: Exclude<NativeEmbeddingAction, "step">,
  signal?: AbortSignal
) => {
  const starting =
    action === "start" || action === "external" || action === "resume"
  try {
    const status = await nativeEmbeddingCommand(
      action,
      starting ? undefined : signal
    )
    if (starting && status.migration === "building") driveNativeMigration()
    return status
  } catch (error) {
    /**
     * A start that failed before resetting — no external provider, say —
     * already stopped the loop driving the rebuild it was meant to replace.
     * That rebuild is still the one on record, so it keeps being driven.
     */
    if (starting) await resumeNativeMigration().catch(() => undefined)
    throw error
  }
}

/** Startup: continue a rebuild the worker was running when it stopped. */
export const resumeNativeMigration = async (signal?: AbortSignal) => {
  signal?.throwIfAborted()
  const state = await readNativeIndexState()
  if (state.migration === "building" && !state.failed) driveNativeMigration()
}

const embedMigrationRow = async (
  text: string,
  plan: Awaited<ReturnType<typeof resolveEmbeddingPlan>> | undefined,
  signal?: AbortSignal
) => {
  const controller = new AbortController()
  const abort = () => controller.abort(signal?.reason)
  signal?.addEventListener("abort", abort, { once: true })
  if (signal?.aborted) abort()
  const timer = setTimeout(
    () =>
      controller.abort(new DOMException("Embedding timed out", "TimeoutError")),
    60000
  )
  try {
    return plan
      ? await generateEmbeddingWithStrategy(text, undefined, {
          plan,
          signal: controller.signal
        })
      : {
          embedding: await generateBundledEmbedding(text, controller.signal),
          model: BUNDLED_MODEL,
          providerId: BUNDLED_PROVIDER
        }
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener("abort", abort)
  }
}

/** Rebuild against the preferred usable route only; a fallback creates an incompatible corpus. */
const resolveExternalRebuildPlan = async () => {
  const plan = await resolveEmbeddingPlan(undefined, true)
  const preferred = plan.attempts.find((attempt) => attempt.provider?.embed)
  if (!preferred)
    throw new Error("No external embedding provider is configured")
  return { ...plan, attempts: [preferred], sharedAttempt: undefined }
}

const externalCorpusMatches = (
  plan: Awaited<ReturnType<typeof resolveExternalRebuildPlan>> | undefined,
  rows: { embedding?: number[]; model?: string; providerId?: string }[]
) => {
  if (!plan || rows.length === 0) return true
  const preferred = plan.attempts[0]
  const dimension = rows[0].embedding?.length
  return (
    !!dimension &&
    rows.every(
      (row) =>
        row.model === preferred.model &&
        row.providerId === preferred.provider?.id &&
        row.embedding?.length === dimension
    )
  )
}

const externalMigrationPlan = async (
  state: Awaited<ReturnType<typeof readNativeIndexState>>
) => {
  if (state.target !== "external") return undefined
  const plan = await resolveExternalRebuildPlan()
  if (plan.fingerprint !== state.externalPlan)
    throw new Error(
      "External embedding configuration changed; restart migration"
    )
  return plan
}

/** Catch up additions, edits and deletions without discarding completed unchanged rows. */
const reconcileSources = async (
  state: Awaited<ReturnType<typeof readNativeIndexState>>,
  signal?: AbortSignal
) => {
  // Read in id order a page at a time: each row carries its vector, and only
  // the key and fingerprint are kept, so memory stays flat as the corpus grows.
  const snapshots = new Map<
    number | undefined,
    { key: string; fingerprint: string }
  >()
  let afterId = Number.NEGATIVE_INFINITY
  for (;;) {
    signal?.throwIfAborted()
    const page = await vectorDb.vectors
      .where("id")
      .above(afterId)
      .limit(RECONCILE_PAGE_ROWS)
      .toArray()
    if (page.length === 0) break
    for (const doc of page)
      snapshots.set(doc.id, {
        key: sourceKey(doc),
        fingerprint: await fingerprint(doc)
      })
    afterId = page[page.length - 1].id ?? afterId
  }
  await vectorDb.transaction(
    "rw",
    vectorDb.embeddingState,
    vectorDb.embeddingRebuild,
    async () => {
      signal?.throwIfAborted()
      const staged = await vectorDb.embeddingRebuild.toArray()
      const byId = new Map(staged.map((row) => [row.id, row]))
      const removed = staged
        .filter((row) => !snapshots.has(row.id))
        .map((row) => row.id)
      await vectorDb.embeddingRebuild.bulkDelete(removed)
      let current = 0
      for (const [id, { fingerprint: sourceFingerprint }] of snapshots) {
        if (id === undefined) throw new Error("Stored vector has no id")
        const prior = byId.get(id)
        if (prior?.sourceFingerprint === sourceFingerprint) {
          if (prior.embedding) current++
          const pending = prior.embedding ? 0 : 1
          if (prior.pending !== pending)
            await vectorDb.embeddingRebuild.put({
              ...prior,
              pending
            })
        } else
          await vectorDb.embeddingRebuild.put({
            id,
            sourceFingerprint,
            pending: 1
          })
      }
      state.current = current
      state.total = snapshots.size
      state.lastId = 0
      await vectorDb.embeddingState.put(state)
    }
  )
  return snapshots
}

/** Only content/metadata are compared inside the short final transaction; hashes are computed beforehand. */
const sourceKey = (doc: VectorDocument) =>
  JSON.stringify({ id: doc.id, content: doc.content, metadata: doc.metadata })

/** Begin a new snapshot or discard staging without changing the active route. */
const resetMigration = async (
  action: "start" | "external" | "keep" | "cancel",
  state: Awaited<ReturnType<typeof readNativeIndexState>>,
  signal?: AbortSignal
) => {
  const starting = action === "start" || action === "external"
  const externalPlan =
    action === "external" ? await resolveExternalRebuildPlan() : undefined
  snapshotEpoch++
  const next = {
    ...withoutFailure(state),
    migration: starting ? ("building" as const) : ("idle" as const),
    current: 0,
    total: 0,
    lastId: 0
  }
  if (starting) {
    next.target = action === "external" ? "external" : "bundled"
    next.externalPlan = externalPlan?.fingerprint
  }
  await vectorDb.transaction(
    "rw",
    vectorDb.embeddingState,
    vectorDb.embeddingRebuild,
    async () => {
      signal?.throwIfAborted()
      await vectorDb.embeddingRebuild.clear()
      await vectorDb.embeddingState.put(next)
    }
  )
  if (starting) await reconcileSources(next, signal)
  return nativeEmbeddingStatus()
}

const runCommand = async (
  action: NativeEmbeddingAction,
  signal?: AbortSignal
) => {
  signal?.throwIfAborted()
  const state = await readNativeIndexState()
  if (action === "dismiss") {
    await writeSetting(SETTINGS.BUNDLED_EMBEDDING_NOTICE_DISMISSED, true)
    return nativeEmbeddingStatus()
  }
  if (action === "resume") {
    if (state.migration === "building" && state.failed)
      await vectorDb.embeddingState.put(withoutFailure(state))
    return nativeEmbeddingStatus()
  }
  if (action === "keep" || action === "external")
    await writeSetting(SETTINGS.BUNDLED_EMBEDDING_NOTICE_DISMISSED, true)
  if (action !== "step") return resetMigration(action, state, signal)
  if (state.migration !== "building") return nativeEmbeddingStatus()
  const plan = await externalMigrationPlan(state)
  const rows = await vectorDb.embeddingRebuild
    .where("[pending+id]")
    .above([1, state.lastId])
    .limit(8)
    .toArray()
  let sourceChanged = false
  const deadline = Date.now() + 30000
  for (const row of rows) {
    signal?.throwIfAborted()
    const source = await vectorDb.vectors.get(row.id)
    if (!source || (await fingerprint(source)) !== row.sourceFingerprint) {
      sourceChanged = true
      continue
    }
    const { embedding, model, providerId } = await embedMigrationRow(
      source.content,
      plan,
      signal
    )
    if (!externalCorpusMatches(plan, [{ embedding, model, providerId }]))
      throw new Error(
        "External embedding index contains incompatible vectors; restart migration"
      )
    signal?.throwIfAborted()
    await vectorDb.transaction(
      "rw",
      vectorDb.embeddingRebuild,
      vectorDb.embeddingState,
      async () => {
        signal?.throwIfAborted()
        await vectorDb.embeddingRebuild.put({
          ...row,
          pending: 0,
          embedding,
          model,
          providerId
        })
        state.current += 1
        state.lastId = row.id
        await vectorDb.embeddingState.put(state)
      }
    )
    if (Date.now() >= deadline) break
  }
  const checked =
    sourceChanged || state.current === state.total
      ? await reconcileSources(state, signal)
      : undefined
  if (state.current === state.total && checked) {
    if (state.total === 0)
      await embedMigrationRow(
        "Embedding provider readiness check",
        plan,
        signal
      )
    await externalMigrationPlan(state)
    await vectorDb.transaction(
      "rw",
      vectorDb.vectors,
      vectorDb.vectorStats,
      vectorDb.embeddingState,
      vectorDb.embeddingRebuild,
      async () => {
        signal?.throwIfAborted()
        const originalCount = await vectorDb.vectors.count()
        const stagedCount = await vectorDb.embeddingRebuild.count()
        if (originalCount !== checked.size || stagedCount !== checked.size)
          return

        let sourceChanged = false
        await vectorDb.vectors.orderBy("id").each((document) => {
          signal?.throwIfAborted()
          if (
            document.id === undefined ||
            checked.get(document.id)?.key !== sourceKey(document)
          )
            sourceChanged = true
        })
        if (sourceChanged) return

        let stagedChanged = false
        let incompatibleExternal = false
        let externalDimension: number | undefined
        await vectorDb.embeddingRebuild.orderBy("id").each((row) => {
          signal?.throwIfAborted()
          if (checked.get(row.id)?.fingerprint !== row.sourceFingerprint)
            stagedChanged = true
          if (state.target !== "external") return
          if (!externalCorpusMatches(plan, [row])) {
            incompatibleExternal = true
            return
          }
          const dimension = row.embedding?.length
          if (
            externalDimension !== undefined &&
            dimension !== externalDimension
          )
            incompatibleExternal = true
          else if (dimension !== undefined) externalDimension = dimension
        })
        if (stagedChanged) return

        signal?.throwIfAborted()
        if (incompatibleExternal) {
          await vectorDb.embeddingRebuild.clear()
          await vectorDb.embeddingState.put({
            ...state,
            migration: "changed",
            current: 0,
            total: 0,
            lastId: 0
          })
          return
        }
        const storageDelta = emptyVectorStorageStats()
        let lastId = 0
        for (;;) {
          signal?.throwIfAborted()
          const row = await vectorDb.embeddingRebuild
            .where("id")
            .above(lastId)
            .first()
          if (!row) break
          lastId = row.id
          const source = await vectorDb.vectors.get(row.id)
          if (!source) throw new Error("Migration source is missing")
          if (
            !row.embedding ||
            (state.target === "external"
              ? row.embedding.length === 0 || !row.model || !row.providerId
              : row.embedding.length !== 384) ||
            !row.embedding.every(Number.isFinite)
          )
            throw new Error("Incomplete embedding migration")
          const { normalized, norm } = normalizeVector(row.embedding)
          const replacement = encodeVectorDocument({
            ...source,
            embedding: row.embedding,
            normalizedEmbedding: normalized,
            norm,
            metadata: {
              ...source.metadata,
              embeddingModel: row.model || BUNDLED_MODEL,
              embeddingProviderId: row.providerId || BUNDLED_PROVIDER,
              embeddingDim: row.embedding.length
            }
          })
          recordVectorStorageChange(storageDelta, {
            before: source,
            after: replacement
          })
          await vectorDb.vectors.put(replacement)
        }
        await applyVectorStorageDelta(vectorDb.vectorStats, storageDelta)
        signal?.throwIfAborted()
        await vectorDb.embeddingState.put({
          ...state,
          mode: state.target || "bundled",
          migration: "idle",
          generation: state.generation + 1
        })
        await vectorDb.embeddingRebuild.clear()
      }
    )
  }
  return nativeEmbeddingStatus()
}
