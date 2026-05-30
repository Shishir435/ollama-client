import { vectorDb } from "./db"
import type { VectorDocument } from "./types"

export interface VectorConsistencyInput {
  existingSessionIds?: Set<string>
  existingMessageIds?: Set<number>
  existingFileIds?: Set<string>
}

export interface VectorConsistencyReport {
  totalVectors: number
  orphanChatVectors: number
  orphanFileVectors: number
  duplicateVectors: number
  missingEmbeddingDimensions: number
  mixedDimensions: boolean
  byDimension: Record<string, number>
}

const vectorIdentity = (doc: VectorDocument): string => {
  const metadata = doc.metadata
  return [
    metadata.type,
    metadata.sessionId || "",
    metadata.messageId || "",
    metadata.fileId || "",
    metadata.url || "",
    metadata.chunkIndex ?? "",
    doc.content
  ].join("\u0000")
}

export const checkVectorConsistency = async ({
  existingSessionIds,
  existingMessageIds,
  existingFileIds
}: VectorConsistencyInput = {}): Promise<VectorConsistencyReport> => {
  const vectors = await vectorDb.vectors.toArray()
  const seen = new Set<string>()
  const byDimension: Record<string, number> = {}

  let orphanChatVectors = 0
  let orphanFileVectors = 0
  let duplicateVectors = 0
  let missingEmbeddingDimensions = 0

  for (const doc of vectors) {
    const identity = vectorIdentity(doc)
    if (seen.has(identity)) {
      duplicateVectors += 1
    } else {
      seen.add(identity)
    }

    const dimension = doc.metadata.embeddingDim ?? doc.embedding.length
    if (dimension > 0) {
      const key = String(dimension)
      byDimension[key] = (byDimension[key] || 0) + 1
    } else {
      missingEmbeddingDimensions += 1
    }

    if (doc.metadata.type === "chat") {
      if (
        doc.metadata.sessionId &&
        existingSessionIds &&
        !existingSessionIds.has(doc.metadata.sessionId)
      ) {
        orphanChatVectors += 1
        continue
      }

      if (
        typeof doc.metadata.messageId === "number" &&
        existingMessageIds &&
        !existingMessageIds.has(doc.metadata.messageId)
      ) {
        orphanChatVectors += 1
      }
    }

    if (
      doc.metadata.type === "file" &&
      doc.metadata.fileId &&
      existingFileIds &&
      !existingFileIds.has(doc.metadata.fileId)
    ) {
      orphanFileVectors += 1
    }
  }

  return {
    totalVectors: vectors.length,
    orphanChatVectors,
    orphanFileVectors,
    duplicateVectors,
    missingEmbeddingDimensions,
    mixedDimensions: Object.keys(byDimension).length > 1,
    byDimension
  }
}
