import { estimateTokens } from "@/lib/embeddings/chunker"
import { generateEmbeddingUnified } from "@/lib/embeddings/embedder-factory"
import { searchHybrid } from "@/lib/embeddings/search"
import type { VectorDocument } from "@/lib/embeddings/types"
import type {
  RagChunk,
  RagSourceType,
  RetrievedChunk,
  RetrieveRequest,
  RetrieveResponse,
  Retriever
} from "./interfaces"

const toRagChunk = (doc: VectorDocument): RagChunk => {
  const documentId =
    doc.metadata.fileId || doc.metadata.sessionId || `${doc.id || 0}`

  return {
    id: `${doc.id || 0}`,
    documentId,
    text: doc.content,
    tokenEstimate: estimateTokens(doc.content),
    chunkIndex: doc.metadata.chunkIndex || 0,
    totalChunks: doc.metadata.totalChunks || 1,
    metadata: {
      source: doc.metadata.source,
      sourceType: doc.metadata.type,
      fileId: doc.metadata.fileId,
      sessionId: doc.metadata.sessionId,
      title: doc.metadata.title,
      createdAt: doc.metadata.timestamp
    }
  }
}

const applyRecencyBias = (
  score: number,
  createdAt: number,
  bias: number
): number => {
  if (bias <= 0) {
    return score
  }

  const ageDays = Math.max((Date.now() - createdAt) / (24 * 60 * 60 * 1000), 0)
  const decay = Math.exp(-ageDays / 30)
  return score * (1 + decay * Math.min(bias, 1))
}

const stableSort = (items: RetrievedChunk[]): RetrievedChunk[] => {
  return [...items].sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score
    }

    const aTime = Number(a.chunk.metadata.createdAt || 0)
    const bTime = Number(b.chunk.metadata.createdAt || 0)
    if (bTime !== aTime) {
      return bTime - aTime
    }

    return a.chunk.id.localeCompare(b.chunk.id)
  })
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

/**
 * Browser retriever adapter that keeps heavy work async and deterministic.
 */
export class BrowserRetriever implements Retriever {
  async retrieve(
    request: RetrieveRequest,
    signal?: AbortSignal
  ): Promise<RetrieveResponse> {
    if (signal?.aborted) {
      throw new Error("Retrieval aborted")
    }

    const embeddingResult = await generateEmbeddingUnified(request.query)
    if ("error" in embeddingResult) {
      return {
        query: request.query,
        chunks: [],
        tokenEstimate: 0
      }
    }

    const raw = await searchHybrid(request.query, embeddingResult.embedding, {
      limit: Math.max(request.maxResults * 2, request.maxResults),
      minSimilarity: request.minScore,
      type: toVectorSourceType(request.filter?.sourceType),
      fileId: request.filter?.documentIds,
      adaptiveWeights: true
    })

    if (signal?.aborted) {
      throw new Error("Retrieval aborted")
    }

    const withScores: RetrievedChunk[] = raw.map((item) => {
      const chunk = toRagChunk(item.document)
      const createdAt = Number(chunk.metadata.createdAt || Date.now())
      const adjustedScore = applyRecencyBias(
        item.similarity,
        createdAt,
        request.recencyBias || 0
      )

      return {
        chunk,
        score: adjustedScore,
        reasons: [
          `hybrid_score=${item.similarity.toFixed(4)}`,
          request.recencyBias ? "recency_bias_applied" : "recency_bias_disabled"
        ]
      }
    })

    const ordered = stableSort(withScores)
    const selected: RetrievedChunk[] = []
    let usedTokens = 0

    for (const item of ordered) {
      if (signal?.aborted) {
        throw new Error("Retrieval aborted")
      }

      if (selected.length >= request.maxResults) {
        break
      }

      const tokens = item.chunk.tokenEstimate
      if (
        usedTokens + tokens > request.maxContextTokens &&
        selected.length > 0
      ) {
        break
      }

      selected.push(item)
      usedTokens += tokens
    }

    return {
      query: request.query,
      chunks: selected,
      tokenEstimate: usedTokens
    }
  }
}
