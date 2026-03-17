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

import { generateEmbedding } from "@/lib/embeddings/embedding-client"
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
      model: "test-model"
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
