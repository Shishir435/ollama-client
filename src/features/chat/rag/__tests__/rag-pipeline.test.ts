import { beforeEach, describe, expect, it, vi } from "vitest"

import type { VectorDocument } from "@/lib/embeddings/types"
import { formatEnhancedResults, retrieveContextEnhanced } from "../rag-pipeline"

// ─── Mocks for retrieveContextEnhanced tests ─────────────────────────────────
vi.mock("@/lib/embeddings/embedding-client", () => ({
  generateEmbedding: vi.fn()
}))

vi.mock("@/lib/embeddings/search", () => ({
  searchHybrid: vi.fn()
}))

vi.mock("@/lib/embeddings/config", () => ({
  getEmbeddingConfig: vi.fn().mockResolvedValue({
    useReranking: false,
    feedbackEnabled: false,
    useTemporalBoosting: false
  })
}))

vi.mock("@/lib/embeddings/reranker", () => ({
  rerankerService: { setBackend: vi.fn(), setEnabled: vi.fn(), rerank: vi.fn() }
}))

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn(), verbose: vi.fn(), warn: vi.fn() }
}))

vi.mock("@/lib/embeddings/feedback-service", () => ({
  feedbackService: { getFeedbackScore: vi.fn().mockResolvedValue(null) }
}))

vi.mock("@/lib/embeddings/recency-boost", () => ({
  applyRecencyBoost: vi.fn()
}))

import { getEmbeddingConfig } from "@/lib/embeddings/config"
import { generateEmbedding } from "@/lib/embeddings/embedding-client"
import { feedbackService } from "@/lib/embeddings/feedback-service"
import { applyRecencyBoost } from "@/lib/embeddings/recency-boost"
import { rerankerService } from "@/lib/embeddings/reranker"
import { searchHybrid } from "@/lib/embeddings/search"

const makeDoc = (id: number, content: string): VectorDocument => ({
  id,
  content,
  embedding: [0.1, 0.2],
  metadata: {
    source: "doc.pdf",
    title: "Doc",
    type: "file",
    timestamp: Date.now()
  }
})

// ─── formatEnhancedResults ───────────────────────────────────────────────────
describe("formatEnhancedResults", () => {
  it("formats context with doc attributes and includes page metadata in sources", () => {
    const document: VectorDocument = {
      id: 7,
      content: "Hello from page 3",
      embedding: [0.1, 0.2],
      metadata: {
        source: "doc.pdf",
        title: "Doc",
        type: "file",
        timestamp: Date.now(),
        page: 3,
        chunkIndex: 1,
        totalChunks: 5
      }
    }

    const { formattedContext, sources } = formatEnhancedResults(
      [{ document, score: 0.876 }],
      1000
    )

    expect(formattedContext).toBe(
      '<doc id="1" source="Doc" page="3" chunk="2/5" score="0.876">\nHello from page 3\n</doc>'
    )
    expect(sources[0].page).toBe(3)
  })
})

// ─── retrieveContextEnhanced — full mode (BUG-02) ────────────────────────────
describe("retrieveContextEnhanced — full mode", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns search results without re-ranking when mode is 'full'", async () => {
    const fakeEmbedding = [0.5, 0.5]
    vi.mocked(generateEmbedding).mockResolvedValue({
      embedding: fakeEmbedding,
      model: "test-model",
      providerId: "ollama"
    })

    const doc1 = makeDoc(1, "First result")
    const doc2 = makeDoc(2, "Second result")
    vi.mocked(searchHybrid).mockResolvedValue([
      { document: doc1, similarity: 0.92 },
      { document: doc2, similarity: 0.85 }
    ] as any)

    const results = await retrieveContextEnhanced("test query", {
      mode: "full",
      topK: 10,
      minSimilarity: 0.3
    })

    expect(results).toHaveLength(2)
    expect(results[0].score).toBe(0.92)
    expect(results[1].score).toBe(0.85)
    expect(results[0].document.content).toBe("First result")
    // searchHybrid should have been called exactly once (no reranking pass)
    expect(searchHybrid).toHaveBeenCalledTimes(1)
  })

  it("returns empty array when embedding generation fails in full mode", async () => {
    vi.mocked(generateEmbedding).mockResolvedValue({
      error: "Embedding failed"
    } as any)

    const results = await retrieveContextEnhanced("test query", {
      mode: "full"
    })

    expect(results).toEqual([])
    expect(searchHybrid).not.toHaveBeenCalled()
  })
})

// ─── retrieveContextEnhanced — similarity mode ───────────────────────────────
describe("retrieveContextEnhanced — similarity mode", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getEmbeddingConfig).mockResolvedValue({
      useReranking: false,
      feedbackEnabled: false,
      useTemporalBoosting: false
    } as any)
  })

  it("returns up to topK results without calling reranker when embedding succeeds", async () => {
    const fakeEmbedding = [0.1, 0.2]
    vi.mocked(generateEmbedding).mockResolvedValue({
      embedding: fakeEmbedding,
      model: "test-model",
      providerId: "ollama"
    })

    const doc1 = makeDoc(1, "Result one")
    const doc2 = makeDoc(2, "Result two")
    const doc3 = makeDoc(3, "Result three")
    vi.mocked(searchHybrid).mockResolvedValue([
      { document: doc1, similarity: 0.9 },
      { document: doc2, similarity: 0.8 },
      { document: doc3, similarity: 0.7 }
    ] as any)

    const results = await retrieveContextEnhanced("query", {
      mode: "similarity",
      topK: 2,
      minSimilarity: 0.3,
      diversityEnabled: false
    })

    // Should return at most topK results
    expect(results.length).toBeLessThanOrEqual(2)
    expect(results[0].document.content).toBe("Result one")
  })

  it("returns empty array when generateEmbedding fails in similarity mode", async () => {
    vi.mocked(generateEmbedding).mockResolvedValue({
      error: "Embedding service unavailable"
    } as any)

    const results = await retrieveContextEnhanced("query", {
      mode: "similarity"
    })

    expect(results).toEqual([])
    expect(searchHybrid).not.toHaveBeenCalled()
  })

  it("returns empty array when searchHybrid returns empty array", async () => {
    vi.mocked(generateEmbedding).mockResolvedValue({
      embedding: [0.5, 0.5],
      model: "test-model",
      providerId: "ollama"
    })
    vi.mocked(searchHybrid).mockResolvedValue([])

    const results = await retrieveContextEnhanced("query", {
      mode: "similarity",
      diversityEnabled: false
    })

    expect(results).toEqual([])
  })
})

// ─── retrieveContextEnhanced — with memory search ────────────────────────────
describe("retrieveContextEnhanced — includeMemory: true", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getEmbeddingConfig).mockResolvedValue({
      useReranking: false,
      feedbackEnabled: false,
      useTemporalBoosting: false
    } as any)
  })

  it("calls searchHybrid twice — once for file type, once for chat type", async () => {
    vi.mocked(generateEmbedding).mockResolvedValue({
      embedding: [0.3, 0.7],
      model: "test-model",
      providerId: "ollama"
    })

    const fileDoc = makeDoc(10, "File result")
    const memoryDoc: VectorDocument = {
      id: 20,
      content: "Memory result",
      embedding: [0.4, 0.6],
      metadata: {
        source: "chat",
        title: "Chat",
        type: "chat",
        timestamp: Date.now()
      }
    }

    // First call → file candidates, second call → chat/memory candidates
    vi.mocked(searchHybrid)
      .mockResolvedValueOnce([{ document: fileDoc, similarity: 0.85 }] as any)
      .mockResolvedValueOnce([{ document: memoryDoc, similarity: 0.75 }] as any)

    await retrieveContextEnhanced("query", {
      mode: "similarity",
      includeMemory: true,
      memoryTopK: 2,
      diversityEnabled: false
    })

    expect(searchHybrid).toHaveBeenCalledTimes(2)

    const calls = vi.mocked(searchHybrid).mock.calls
    // First call should be for file type
    expect(calls[0][2]).toMatchObject({ type: "file" })
    // Second call should be for chat type
    expect(calls[1][2]).toMatchObject({ type: "chat" })
  })

  it("memory results have isMemory: true and score multiplied by 0.9", async () => {
    vi.mocked(generateEmbedding).mockResolvedValue({
      embedding: [0.3, 0.7],
      model: "test-model",
      providerId: "ollama"
    })

    const fileDoc = makeDoc(10, "File result")
    const memoryDoc: VectorDocument = {
      id: 20,
      content: "Memory result",
      embedding: [0.4, 0.6],
      metadata: {
        source: "chat",
        title: "Chat",
        type: "chat",
        timestamp: Date.now()
      }
    }
    const memorySimilarity = 0.8

    vi.mocked(searchHybrid)
      .mockResolvedValueOnce([{ document: fileDoc, similarity: 0.9 }] as any)
      .mockResolvedValueOnce([
        { document: memoryDoc, similarity: memorySimilarity }
      ] as any)

    const results = await retrieveContextEnhanced("query", {
      mode: "similarity",
      includeMemory: true,
      memoryTopK: 1,
      diversityEnabled: false
    })

    const memResult = results.find((r) => r.isMemory === true)
    expect(memResult).toBeDefined()
    expect(memResult?.isMemory).toBe(true)
    // Score should be the original similarity * 0.9
    expect(memResult?.score).toBeCloseTo(memorySimilarity * 0.9, 5)
  })
})

// ─── formatEnhancedResults — token budget ────────────────────────────────────
describe("formatEnhancedResults — token budget", () => {
  it("includes at least one result even when it exceeds maxTokens", () => {
    const bigDoc: VectorDocument = {
      id: 1,
      content: "X".repeat(10000), // ~2500 tokens — far exceeds any small budget
      embedding: [0.1, 0.2],
      metadata: {
        source: "big.pdf",
        title: "Big",
        type: "file",
        timestamp: Date.now()
      }
    }

    const { documents, formattedContext } = formatEnhancedResults(
      [{ document: bigDoc, score: 0.99 }],
      1 // maxTokens = 1, impossibly small
    )

    // At-least-one guarantee
    expect(documents).toHaveLength(1)
    expect(formattedContext).toContain("X")
  })

  it("includes all results when no maxTokens is provided", () => {
    const docs = [
      makeDoc(1, "First"),
      makeDoc(2, "Second"),
      makeDoc(3, "Third")
    ]
    const results = docs.map((d, i) => ({ document: d, score: 0.9 - i * 0.1 }))

    const { documents } = formatEnhancedResults(results)

    expect(documents).toHaveLength(3)
  })

  it("sources for a memory result has type 'memory' and isMemory: true", () => {
    const memDoc: VectorDocument = {
      id: 5,
      content: "From a previous chat.",
      embedding: [0.1, 0.2],
      metadata: {
        source: "chat",
        title: "Chat",
        type: "chat",
        timestamp: Date.now()
      }
    }

    const { sources } = formatEnhancedResults(
      [{ document: memDoc, score: 0.7, isMemory: true }],
      1000
    )

    expect(sources).toHaveLength(1)
    expect(sources[0].type).toBe("memory")
    expect((sources[0] as any).isMemory).toBe(true)
  })
})

// ─── Stage 2 — reranking enabled ─────────────────────────────────────────────
describe("retrieveContextEnhanced — reranking enabled", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getEmbeddingConfig).mockResolvedValue({
      useReranking: true,
      rerankerBackend: "ollama",
      minRerankScore: 0.5,
      feedbackEnabled: false,
      useTemporalBoosting: false
    } as any)

    vi.mocked(generateEmbedding).mockResolvedValue({
      embedding: [0.5, 0.5],
      model: "test-model",
      providerId: "ollama"
    })
  })

  it("returns results that pass the rerank score threshold", async () => {
    const doc1 = makeDoc(1, "Relevant content A")
    const doc2 = makeDoc(2, "Relevant content B")

    vi.mocked(searchHybrid).mockResolvedValue([
      { document: doc1, similarity: 0.8 },
      { document: doc2, similarity: 0.75 }
    ] as any)

    vi.mocked(rerankerService.rerank).mockResolvedValue([
      { content: "Relevant content A", score: 0.85, metadata: doc1.metadata },
      { content: "Relevant content B", score: 0.72, metadata: doc2.metadata }
    ] as any)

    const results = await retrieveContextEnhanced("test query", {
      mode: "similarity",
      topK: 5,
      diversityEnabled: false
    })

    // Both have score >= 0.5, so both should be returned
    expect(results.length).toBeGreaterThan(0)
    expect(results.every((r) => r.score >= 0.5)).toBe(true)
  })

  it("returns empty array when all reranked results score below threshold", async () => {
    const doc1 = makeDoc(1, "Low relevance content")

    vi.mocked(searchHybrid).mockResolvedValue([
      { document: doc1, similarity: 0.4 }
    ] as any)

    vi.mocked(rerankerService.rerank).mockResolvedValue([
      { content: "Low relevance content", score: 0.2, metadata: doc1.metadata }
    ] as any)

    const results = await retrieveContextEnhanced("test query", {
      mode: "similarity",
      topK: 5,
      diversityEnabled: false
    })

    expect(results).toEqual([])
  })

  it("calls rerankerService.setBackend and setEnabled with correct arguments", async () => {
    const doc1 = makeDoc(1, "Some content")

    vi.mocked(searchHybrid).mockResolvedValue([
      { document: doc1, similarity: 0.8 }
    ] as any)

    vi.mocked(rerankerService.rerank).mockResolvedValue([
      { content: "Some content", score: 0.9, metadata: doc1.metadata }
    ] as any)

    await retrieveContextEnhanced("test query", {
      mode: "similarity",
      topK: 5,
      diversityEnabled: false
    })

    expect(rerankerService.setBackend).toHaveBeenCalledWith("ollama")
    expect(rerankerService.setEnabled).toHaveBeenCalledWith(true)
  })
})

// ─── Stage 2.5 — feedback blending ───────────────────────────────────────────
describe("retrieveContextEnhanced — feedback blending", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getEmbeddingConfig).mockResolvedValue({
      useReranking: false,
      feedbackEnabled: true,
      feedbackBlendWeight: 0.2,
      useTemporalBoosting: false
    } as any)

    vi.mocked(generateEmbedding).mockResolvedValue({
      embedding: [0.5, 0.5],
      model: "test-model",
      providerId: "ollama"
    })
  })

  it("blends feedback score into result score when feedbackScore is non-null", async () => {
    const doc = makeDoc(42, "Feedback content")
    const originalSimilarity = 0.6

    vi.mocked(searchHybrid).mockResolvedValue([
      { document: doc, similarity: originalSimilarity }
    ] as any)

    const feedbackScore = 0.9
    vi.mocked(feedbackService.getFeedbackScore).mockResolvedValue(feedbackScore)

    const results = await retrieveContextEnhanced("query", {
      mode: "similarity",
      topK: 5,
      diversityEnabled: false
    })

    expect(results).toHaveLength(1)
    // blend formula: (1 - 0.2) * originalSimilarity + 0.2 * feedbackScore
    const expected = (1 - 0.2) * originalSimilarity + 0.2 * feedbackScore
    expect(results[0].score).toBeCloseTo(expected, 5)
  })

  it("leaves score unchanged when feedbackScore is null", async () => {
    const doc = makeDoc(43, "No feedback content")
    const originalSimilarity = 0.7

    vi.mocked(searchHybrid).mockResolvedValue([
      { document: doc, similarity: originalSimilarity }
    ] as any)

    vi.mocked(feedbackService.getFeedbackScore).mockResolvedValue(null)

    const results = await retrieveContextEnhanced("query", {
      mode: "similarity",
      topK: 5,
      diversityEnabled: false
    })

    expect(results).toHaveLength(1)
    expect(results[0].score).toBeCloseTo(originalSimilarity, 5)
  })
})

// ─── Stage 2.6 — temporal boosting ───────────────────────────────────────────
describe("retrieveContextEnhanced — temporal boosting", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getEmbeddingConfig).mockResolvedValue({
      useReranking: false,
      feedbackEnabled: false,
      useTemporalBoosting: true,
      temporalBoostWeight: 0.3,
      temporalHalfLife: 90
    } as any)

    vi.mocked(generateEmbedding).mockResolvedValue({
      embedding: [0.5, 0.5],
      model: "test-model",
      providerId: "ollama"
    })
  })

  it("calls applyRecencyBoost on non-memory file results when useTemporalBoosting is true", async () => {
    const fileDoc = makeDoc(10, "File result content")
    const memoryDoc: VectorDocument = {
      id: 20,
      content: "Memory result content",
      embedding: [0.4, 0.6],
      metadata: {
        source: "chat",
        title: "Chat",
        type: "chat",
        timestamp: Date.now()
      }
    }

    vi.mocked(searchHybrid)
      .mockResolvedValueOnce([{ document: fileDoc, similarity: 0.85 }] as any)
      .mockResolvedValueOnce([{ document: memoryDoc, similarity: 0.75 }] as any)

    await retrieveContextEnhanced("query", {
      mode: "similarity",
      topK: 5,
      includeMemory: true,
      memoryTopK: 1,
      diversityEnabled: false
    })

    expect(applyRecencyBoost).toHaveBeenCalledTimes(1)
    // The argument passed to applyRecencyBoost should only contain non-memory results
    const boostedResults = vi.mocked(applyRecencyBoost).mock
      .calls[0][0] as any[]
    expect(boostedResults.every((r: any) => !r.isMemory)).toBe(true)
  })
})
