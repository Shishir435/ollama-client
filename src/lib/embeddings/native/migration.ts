import Dexie from "dexie"
import { readSetting, writeSetting } from "@/lib/storage/setting-access"
import { SETTINGS } from "@/lib/storage/settings"
import { vectorDb } from "../db"
import {
  generateEmbeddingWithStrategy,
  resolveEmbeddingPlan
} from "../embedding-strategy"
import { normalizeVector } from "../math"
import type { VectorDocument } from "../types"
import { generateBundledEmbedding } from "./client"
import { BUNDLED_MODEL, BUNDLED_PROVIDER } from "./constants"
import { readNativeIndexState } from "./state"

/** Retain a fingerprint rather than a second copy of content users may later delete. */
const fingerprint = async (document: VectorDocument): Promise<string> => {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(document))
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

/** Serialize commands from multiple open settings pages; batches survive worker restarts. */
let commands: Promise<unknown> = Promise.resolve()
export const nativeEmbeddingCommand = (
  action: "start" | "step" | "cancel" | "keep" | "dismiss" | "external",
  signal?: AbortSignal
) => {
  const work = commands
    .catch(() => undefined)
    .then(() => runCommand(action, signal))
  commands = work
  return work
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

const runCommand = async (
  action: "start" | "step" | "cancel" | "keep" | "dismiss" | "external",
  signal?: AbortSignal
) => {
  signal?.throwIfAborted()
  const state = await readNativeIndexState()
  if (action === "dismiss") {
    await writeSetting(SETTINGS.BUNDLED_EMBEDDING_NOTICE_DISMISSED, true)
    return nativeEmbeddingStatus()
  }
  if (action === "keep" || action === "external")
    await writeSetting(SETTINGS.BUNDLED_EMBEDDING_NOTICE_DISMISSED, true)
  if (action !== "step") {
    const starting = action === "start" || action === "external"
    const externalPlan =
      action === "external" ? await resolveExternalRebuildPlan() : undefined
    const documents = starting ? await vectorDb.vectors.toArray() : []
    const snapshot = await Promise.all(
      documents.map(async (source) => {
        if (source.id === undefined) throw new Error("Stored vector has no id")
        return { id: source.id, sourceFingerprint: await fingerprint(source) }
      })
    )
    await vectorDb.transaction(
      "rw",
      vectorDb.vectors,
      vectorDb.embeddingState,
      vectorDb.embeddingRebuild,
      async () => {
        signal?.throwIfAborted()
        await vectorDb.embeddingRebuild.clear()
        const next = {
          ...state,
          migration: "idle" as "idle" | "building",
          current: 0,
          total: 0,
          lastId: 0
        }
        if (starting) {
          await vectorDb.embeddingRebuild.bulkPut(snapshot)
          next.migration = "building"
          next.total = documents.length
          next.target = action === "external" ? "external" : "bundled"
          next.externalPlan = externalPlan?.fingerprint
        }
        await vectorDb.embeddingState.put(next)
      }
    )
    return nativeEmbeddingStatus()
  }
  if (state.migration !== "building") return nativeEmbeddingStatus()
  const plan = await externalMigrationPlan(state)
  const rows = await vectorDb.embeddingRebuild
    .where("id")
    .above(state.lastId)
    .limit(8)
    .toArray()
  const deadline = Date.now() + 30000
  for (const row of rows) {
    signal?.throwIfAborted()
    const source = await vectorDb.vectors.get(row.id)
    if (!source || (await fingerprint(source)) !== row.sourceFingerprint) {
      await vectorDb.transaction(
        "rw",
        vectorDb.embeddingState,
        vectorDb.embeddingRebuild,
        async () => {
          signal?.throwIfAborted()
          await vectorDb.embeddingRebuild.clear()
          await vectorDb.embeddingState.put({
            ...state,
            migration: "changed",
            current: 0,
            total: 0,
            lastId: 0
          })
        }
      )
      return nativeEmbeddingStatus()
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
  if (state.current === state.total) {
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
      vectorDb.embeddingState,
      vectorDb.embeddingRebuild,
      async () => {
        signal?.throwIfAborted()
        const originals = await vectorDb.vectors.toArray()
        const staged = await vectorDb.embeddingRebuild.orderBy("id").toArray()
        const byId = new Map(originals.map((doc) => [doc.id, doc]))
        // Never resurrect a deleted source or overwrite an ingestion that arrived during migration.
        const fingerprints = await Dexie.waitFor(
          Promise.all(
            originals.map(
              async (doc) => [doc.id, await fingerprint(doc)] as const
            )
          )
        )
        signal?.throwIfAborted()
        const currentFingerprints = new Map(fingerprints)
        if (
          !externalCorpusMatches(plan, staged) ||
          originals.length !== staged.length ||
          staged.some(
            (row) => currentFingerprints.get(row.id) !== row.sourceFingerprint
          )
        ) {
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
        const replacements = staged.map((row) => {
          const source = byId.get(row.id)
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
          return {
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
          }
        })
        await vectorDb.vectors.bulkPut(replacements)
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
