import { normalizeVector } from "./math"
import type { VectorDocument } from "./types"

/** A vector row as IndexedDB holds it: the unit vector as float32, no `embedding`. */
export type StoredVectorDocument = Omit<VectorDocument, "embedding"> & {
  normalizedEmbedding: Float32Array
  norm: number
}

/** True for a row still in the earlier shape: float64 `number[]` arrays. */
export const isLegacyVectorRow = (row: {
  normalizedEmbedding?: ArrayLike<number>
}): boolean => !(row.normalizedEmbedding instanceof Float32Array)

/**
 * Converts a document to its stored shape.
 *
 * Only the unit vector and its norm are kept. The raw vector is the unit
 * vector scaled by the norm, so storing it as well wrote every vector twice,
 * as float64 — about 6 KB of a 384-dimension row. Float32 rounding moves a
 * cosine by about 1e-7, far below any similarity threshold in use.
 */
export const encodeVectorDocument = (
  document: VectorDocument | StoredVectorDocument
): StoredVectorDocument => {
  const { embedding, ...rest } = document as VectorDocument
  let normalized: ArrayLike<number> | undefined = document.normalizedEmbedding
  let norm = document.norm
  if (normalized === undefined || norm === undefined) {
    const computed = normalizeVector(embedding)
    normalized = computed.normalized
    norm = computed.norm
  }
  return {
    ...rest,
    normalizedEmbedding:
      normalized instanceof Float32Array
        ? normalized
        : Float32Array.from(normalized),
    norm
  }
}

/** Dimension of a row in either shape, without materialising `embedding`. */
export const vectorDimension = (document: {
  normalizedEmbedding?: ArrayLike<number>
  embedding?: ArrayLike<number>
}): number =>
  document.normalizedEmbedding?.length ?? document.embedding?.length ?? 0

/**
 * Dexie read hook: gives a stored row the `embedding` the rest of the code
 * expects, built on first access.
 *
 * Search scans read only `normalizedEmbedding` and `norm`, so they never pay
 * for the conversion. The property is non-enumerable, so spreading or
 * re-putting a row cannot write the float64 copy back.
 */
export const attachLegacyEmbedding = <T extends object>(row: T): T => {
  // Dexie passes `undefined` for a missing key (`get`, `bulkGet`).
  if (row == null) return row
  const stored = row as T & {
    embedding?: number[]
    normalizedEmbedding?: ArrayLike<number>
    norm?: number
  }
  if (
    stored.embedding !== undefined ||
    !(stored.normalizedEmbedding instanceof Float32Array)
  )
    return row
  const unit = stored.normalizedEmbedding
  const norm = stored.norm ?? 1
  let cached: number[] | undefined
  Object.defineProperty(row, "embedding", {
    enumerable: false,
    configurable: true,
    get: () => (cached ??= Array.from(unit, (value) => value * norm)),
    set: (value: number[]) => {
      cached = value
    }
  })
  return row
}
