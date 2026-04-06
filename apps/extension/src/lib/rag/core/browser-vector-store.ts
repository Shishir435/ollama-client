import { hnswIndexManager } from "@/lib/embeddings/hnsw-index"
import { searchSimilarVectors } from "@/lib/embeddings/search"
import { clearAllVectors, storeVector } from "@/lib/embeddings/storage"
import type { VectorDocument } from "@/lib/embeddings/types"
import { vectorDb } from "@/lib/embeddings/vector-store"
import type {
  RagChunk,
  RagSourceType,
  VectorRecord,
  VectorSearchRequest,
  VectorSearchResult,
  VectorStore
} from "./interfaces"

const resolveSourceType = (value?: string): RagSourceType => {
  if (value === "chat" || value === "file" || value === "webpage") {
    return value
  }
  return "manual"
}

const toVectorSourceType = (
  sourceType?: RagSourceType
): VectorDocument["metadata"]["type"] | undefined => {
  if (
    sourceType === "chat" ||
    sourceType === "file" ||
    sourceType === "webpage"
  ) {
    return sourceType
  }
  return undefined
}

const chunkFromVectorDoc = (doc: VectorDocument): RagChunk => {
  const sourceType = resolveSourceType(doc.metadata.type)
  const documentId =
    doc.metadata.fileId || doc.metadata.sessionId || `${doc.id || 0}`

  return {
    id: `${doc.id || 0}`,
    documentId,
    text: doc.content,
    tokenEstimate: Math.ceil(doc.content.length / 4),
    chunkIndex: doc.metadata.chunkIndex || 0,
    totalChunks: doc.metadata.totalChunks || 1,
    metadata: {
      source: doc.metadata.source,
      sourceType,
      fileId: doc.metadata.fileId,
      sessionId: doc.metadata.sessionId,
      createdAt: doc.metadata.timestamp
    }
  }
}

const metadataTypeFromChunk = (
  chunk: RagChunk
): VectorDocument["metadata"]["type"] => {
  const sourceType = chunk.metadata.sourceType
  if (sourceType === "chat" || sourceType === "webpage") {
    return sourceType
  }
  return "file"
}

const matchMetadata = (
  metadata: RagChunk["metadata"],
  expected?: Record<
    string,
    string | number | boolean | Array<string | number | boolean>
  >
): boolean => {
  if (!expected) {
    return true
  }

  return Object.entries(expected).every(([key, value]) => {
    const actual = metadata[key]

    if (Array.isArray(value)) {
      return value.includes(actual as never)
    }

    return actual === value
  })
}

const toDeterministicSort = (
  results: VectorSearchResult[]
): VectorSearchResult[] => {
  return [...results].sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score
    }

    const aTime = Number(a.record.chunk.metadata.createdAt || 0)
    const bTime = Number(b.record.chunk.metadata.createdAt || 0)
    if (bTime !== aTime) {
      return bTime - aTime
    }

    return a.record.chunk.id.localeCompare(b.record.chunk.id)
  })
}

/**
 * Browser vector store adapter backed by Dexie/IndexedDB.
 */
export class BrowserVectorStore implements VectorStore {
  async upsert(records: VectorRecord[], signal?: AbortSignal): Promise<void> {
    for (const record of records) {
      if (signal?.aborted) {
        throw new Error("Vector upsert aborted")
      }

      const timestampRaw = record.chunk.metadata.createdAt
      const timestamp =
        typeof timestampRaw === "number" ? timestampRaw : Date.now()

      await storeVector(record.chunk.text, record.vector, {
        source: String(record.chunk.metadata.source || record.chunk.documentId),
        type: metadataTypeFromChunk(record.chunk),
        timestamp,
        fileId: String(record.chunk.documentId),
        chunkIndex: record.chunk.chunkIndex,
        totalChunks: record.chunk.totalChunks,
        title: String(record.chunk.metadata.title || record.chunk.documentId)
      })
    }
  }

  async search(request: VectorSearchRequest): Promise<VectorSearchResult[]> {
    const raw = await searchSimilarVectors(request.queryVector, {
      limit: request.limit,
      minSimilarity: request.minScore,
      type: toVectorSourceType(request.filter?.sourceType),
      fileId: request.filter?.documentIds
    })

    const createdAfter = request.filter?.createdAfter
    const createdBefore = request.filter?.createdBefore

    const mapped: VectorSearchResult[] = raw
      .map((entry) => {
        const chunk = chunkFromVectorDoc(entry.document)
        const record: VectorRecord = {
          chunk,
          vector: entry.document.embedding,
          normalizedVector: entry.document.normalizedEmbedding,
          norm: entry.document.norm
        }

        return {
          record,
          score: entry.similarity
        }
      })
      .filter((entry) => {
        const timestamp = Number(entry.record.chunk.metadata.createdAt || 0)

        if (typeof createdAfter === "number" && timestamp < createdAfter) {
          return false
        }

        if (typeof createdBefore === "number" && timestamp > createdBefore) {
          return false
        }

        if (
          !matchMetadata(entry.record.chunk.metadata, request.filter?.metadata)
        ) {
          return false
        }

        return true
      })

    return toDeterministicSort(mapped).slice(0, request.limit)
  }

  async deleteByDocumentIds(documentIds: string[]): Promise<number> {
    const ids = new Set(documentIds)
    const toDelete = (await vectorDb.vectors
      .filter((doc) => {
        const fileId = doc.metadata.fileId || ""
        const sessionId = doc.metadata.sessionId || ""
        return ids.has(fileId) || ids.has(sessionId)
      })
      .primaryKeys()) as number[]

    if (toDelete.length > 0) {
      await vectorDb.vectors.bulkDelete(toDelete)
    }

    return toDelete.length
  }

  async clear(): Promise<void> {
    await clearAllVectors()
  }

  async stats(): Promise<{
    totalVectors: number
    estimatedBytes: number
    inMemoryVectors: number
  }> {
    const docs = await vectorDb.vectors.toArray()
    const estimatedBytes = docs.reduce((sum, doc) => {
      const embeddingBytes = doc.embedding.length * 4
      const normalizedBytes = (doc.normalizedEmbedding?.length || 0) * 4
      const contentBytes = doc.content.length * 2
      const metadataBytes = JSON.stringify(doc.metadata).length
      return (
        sum + embeddingBytes + normalizedBytes + contentBytes + metadataBytes
      )
    }, 0)

    return {
      totalVectors: docs.length,
      estimatedBytes,
      inMemoryVectors: hnswIndexManager.getStats().numElements
    }
  }
}
