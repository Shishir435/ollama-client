import type { Table } from "dexie"
import type { VectorDocument } from "./types"

export const VECTOR_STORAGE_STATS_ID = "totals"

export interface VectorStorageStats {
  id: typeof VECTOR_STORAGE_STATS_ID
  totalVectors: number
  totalBytes: number
  byType: Record<string, number>
}

export interface VectorStorageChange {
  before?: VectorDocument
  after?: VectorDocument
}

export const emptyVectorStorageStats = (): VectorStorageStats => ({
  id: VECTOR_STORAGE_STATS_ID,
  totalVectors: 0,
  totalBytes: 0,
  byType: {}
})

const encoder = new TextEncoder()
const encodedByteLength = (value: string): number =>
  encoder.encode(value).byteLength

/** Estimates durable vector storage without creating a Blob per document. */
export const estimateVectorStorageSize = (doc: VectorDocument): number => {
  const embeddingSize = doc.embedding.length * 4
  const normalizedSize = doc.normalizedEmbedding
    ? doc.normalizedEmbedding.length * 4
    : 0
  const contentSize = encodedByteLength(doc.content)
  const metadataSize = encodedByteLength(JSON.stringify(doc.metadata))
  return embeddingSize + normalizedSize + contentSize + metadataSize + 100
}

export const applyVectorStorageChanges = async (
  statsTable: Table<VectorStorageStats, string>,
  changes: Iterable<VectorStorageChange>
): Promise<VectorStorageStats> => {
  const delta = emptyVectorStorageStats()
  for (const { before, after } of changes) {
    recordVectorStorageChange(delta, { before, after })
  }
  return applyVectorStorageDelta(statsTable, delta)
}

export const recordVectorStorageChange = (
  delta: VectorStorageStats,
  { before, after }: VectorStorageChange
): void => {
  if (before) applyDocumentDelta(delta, before, -1)
  if (after) applyDocumentDelta(delta, after, 1)
}

export const applyVectorStorageDelta = async (
  statsTable: Table<VectorStorageStats, string>,
  delta: VectorStorageStats
): Promise<VectorStorageStats> => {
  const next =
    (await statsTable.get(VECTOR_STORAGE_STATS_ID)) ?? emptyVectorStorageStats()
  next.totalVectors += delta.totalVectors
  next.totalBytes += delta.totalBytes
  for (const [type, count] of Object.entries(delta.byType)) {
    const nextTypeCount = (next.byType[type] ?? 0) + count
    if (nextTypeCount > 0) next.byType[type] = nextTypeCount
    else delete next.byType[type]
  }

  await statsTable.put(next)
  return next
}

export const addDocumentToVectorStorageStats = (
  stats: VectorStorageStats,
  document: VectorDocument
): void => applyDocumentDelta(stats, document, 1)

const applyDocumentDelta = (
  stats: VectorStorageStats,
  document: VectorDocument,
  direction: 1 | -1
): void => {
  stats.totalVectors += direction
  stats.totalBytes += direction * estimateVectorStorageSize(document)

  const type = document.metadata.type
  const nextTypeCount = (stats.byType[type] ?? 0) + direction
  if (nextTypeCount !== 0) stats.byType[type] = nextTypeCount
  else delete stats.byType[type]
}
