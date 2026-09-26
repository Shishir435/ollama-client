import Dexie from "dexie"
import { readSetting, writeSetting } from "@/lib/storage/setting-access"
import { SETTINGS } from "@/lib/storage/settings"
import { vectorDb } from "../db"
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
  action: "start" | "step" | "cancel" | "keep" | "external",
  signal?: AbortSignal
) => {
  const work = commands
    .catch(() => undefined)
    .then(() => runCommand(action, signal))
  commands = work
  return work
}

const runCommand = async (
  action: "start" | "step" | "cancel" | "keep" | "external",
  signal?: AbortSignal
) => {
  signal?.throwIfAborted()
  const state = await readNativeIndexState()
  if (action === "keep" || action === "external")
    await writeSetting(SETTINGS.BUNDLED_EMBEDDING_NOTICE_DISMISSED, true)
  if (action !== "step") {
    const documents = action === "start" ? await vectorDb.vectors.toArray() : []
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
        if (action === "start") {
          await vectorDb.embeddingRebuild.bulkPut(snapshot)
          next.migration = "building"
          next.total = documents.length
        }
        if (action === "external") {
          next.mode = "external"
          next.generation += 1
        }
        await vectorDb.embeddingState.put(next)
      }
    )
    return nativeEmbeddingStatus()
  }
  if (state.migration !== "building") return nativeEmbeddingStatus()
  const rows = await vectorDb.embeddingRebuild
    .where("id")
    .above(state.lastId)
    .limit(8)
    .toArray()
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
    const embedding = await generateBundledEmbedding(source.content, signal)
    signal?.throwIfAborted()
    await vectorDb.transaction(
      "rw",
      vectorDb.embeddingRebuild,
      vectorDb.embeddingState,
      async () => {
        signal?.throwIfAborted()
        await vectorDb.embeddingRebuild.put({ ...row, embedding })
        state.current += 1
        state.lastId = row.id
        await vectorDb.embeddingState.put(state)
      }
    )
  }
  if (state.current === state.total) {
    if (state.total === 0) await generateBundledEmbedding("", signal)
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
            row.embedding.length !== 384 ||
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
              embeddingModel: BUNDLED_MODEL,
              embeddingProviderId: BUNDLED_PROVIDER,
              embeddingDim: 384
            }
          }
        })
        await vectorDb.vectors.bulkPut(replacements)
        signal?.throwIfAborted()
        await vectorDb.embeddingState.put({
          ...state,
          mode: "bundled",
          migration: "idle",
          generation: state.generation + 1
        })
        await vectorDb.embeddingRebuild.clear()
      }
    )
  }
  return nativeEmbeddingStatus()
}
