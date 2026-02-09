import { describe, expect, it, vi } from "vitest"

import { retrieveContext } from "../rag-retriever"
import * as vectorStore from "@/lib/embeddings/vector-store"
import { knowledgeConfig } from "@/lib/config/knowledge-config"

// Mock dependencies
vi.mock("@/lib/embeddings/vector-store")
vi.mock("@/lib/config/knowledge-config", () => ({
  knowledgeConfig: {
    getRetrievalTopK: vi.fn().mockResolvedValue(4),
    getMinSimilarity: vi.fn().mockResolvedValue(0.5),
    getMaxContextSize: vi.fn().mockResolvedValue(1000)
  }
}))

vi.mock("@/lib/embeddings/embedding-client", () => ({
  generateEmbedding: vi.fn().mockResolvedValue({ embedding: [0.1, 0.2, 0.3] })
}))

vi.mock("../rag-pipeline", () => ({
  retrieveContextEnhanced: vi.fn().mockResolvedValue([
    {
      document: {
        content: "Chunk 1 content",
        metadata: { title: "Doc 1", source: "test.txt", type: "file", chunkIndex: 0, fileId: "file1" }
      },
      score: 0.9
    },
    {
      document: {
        content: "Chunk 2 content",
        metadata: { title: "Doc 1", source: "test.txt", type: "file", chunkIndex: 1, fileId: "file1" }
      },
      score: 0.8
    }
  ]),
  formatEnhancedResults: vi.fn().mockImplementation((results) => ({
    documents: results.map((r: any) => r.document),
    formattedContext: "Chunk 1 content\n\nChunk 2 content",
    sources: [{ title: "Doc 1" }]
  }))
}))

describe("retrieveContext", () => {
  const mockDocuments: vectorStore.VectorDocument[] = [
    {
      content: "Chunk 1 content",
      embedding: [0.1, 0.2, 0.3],
      metadata: { 
        source: "test.txt",
        title: "Doc 1", 
        chunkIndex: 0, 
        fileId: "file1",
        type: "file",
        timestamp: Date.now()
      }
    },
    {
      content: "Chunk 2 content",
      embedding: [0.4, 0.5, 0.6],
      metadata: { 
        source: "test.txt",
        title: "Doc 1", 
        chunkIndex: 1, 
        fileId: "file1",
        type: "file",
        timestamp: Date.now()
      }
    }
  ]

  it("retrieves context using enhanced pipeline by default", async () => {
    const { retrieveContextEnhanced } = await import("../rag-pipeline")
    
    const result = await retrieveContext("query", "file1")

    expect(retrieveContextEnhanced).toHaveBeenCalledWith(
      "query",
      expect.objectContaining({ 
        topK: 4, 
        fileId: "file1", 
        minSimilarity: 0.5,
        diversityEnabled: true
      })
    )
    expect(result.formattedContext).toContain("Chunk 1 content")
  })

  it("retrieves full context when mode is full", async () => {
    vi.mocked(vectorStore.getAllDocuments).mockResolvedValue({
      documents: mockDocuments,
      tokenCount: 100
    })

    const result = await retrieveContext("query", "file1", { mode: "full" })

    expect(vectorStore.getAllDocuments).toHaveBeenCalledWith(
      expect.objectContaining({ fileId: "file1" })
    )
    expect(result.documents).toHaveLength(2)
  })

  it("handles multiple files in full mode", async () => {
    vi.mocked(vectorStore.getAllDocuments).mockResolvedValue({
      documents: [mockDocuments[0]],
      tokenCount: 50
    })

    const result = await retrieveContext("query", ["file1", "file2"], {
      mode: "full"
    })

    expect(vectorStore.getAllDocuments).toHaveBeenCalledTimes(2)
    expect(result.documents).toHaveLength(2) // 1 from each call
  })

  it("falls back to full context when enhanced retrieval returns no results", async () => {
    const { retrieveContextEnhanced } = await import("../rag-pipeline")

    vi.mocked(retrieveContextEnhanced).mockResolvedValueOnce([])
    vi.mocked(vectorStore.getAllDocuments).mockResolvedValue({
      documents: mockDocuments,
      tokenCount: 100
    })

    const result = await retrieveContext("query", "file1")

    expect(vectorStore.getAllDocuments).toHaveBeenCalledWith(
      expect.objectContaining({ fileId: "file1", type: "file" })
    )
    expect(result.documents).toHaveLength(2)
  })
})
