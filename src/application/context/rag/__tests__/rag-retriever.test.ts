import { describe, expect, it, vi } from "vitest"
import * as vectorStore from "@/lib/embeddings/vector-store"
import {
  reformulateQuestion,
  retrieveContext,
  retrieveContextFromSources
} from "../rag-retriever"

// Mock dependencies
vi.mock("@/lib/embeddings/vector-store")
vi.mock("@/lib/config/knowledge-config", () => ({
  knowledgeConfig: {
    getRetrievalTopK: vi.fn().mockResolvedValue(4),
    getMinSimilarity: vi.fn().mockResolvedValue(0.5),
    getMaxContextSize: vi.fn().mockResolvedValue(1000),
    getQuestionPrompt: vi
      .fn()
      .mockResolvedValue("Context: {chat_history}\nQuestion: {question}")
  }
}))

vi.mock("@/lib/embeddings/embedding-client", () => ({
  generateEmbedding: vi.fn().mockResolvedValue({ embedding: [0.1, 0.2, 0.3] }),
  generateEmbeddingsBatch: vi
    .fn()
    .mockResolvedValue([{ embedding: [0.1, 0.2] }]),
  cosineSimilarity: vi.fn().mockReturnValue(0.85)
}))

vi.mock("@/lib/embeddings/config", () => ({
  getEmbeddingConfig: vi.fn().mockResolvedValue({
    chunkSize: 500,
    chunkOverlap: 50,
    chunkingStrategy: "markdown"
  })
}))

vi.mock("@/lib/embeddings/chunker", () => ({
  chunkDocuments: vi.fn().mockResolvedValue([
    {
      pageContent: "chunk content",
      metadata: {
        source: "Test Title",
        title: "Test Title",
        fileId: "src-1",
        chunkIndex: 0,
        totalChunks: 1
      }
    }
  ])
}))

vi.mock("../rag-pipeline", () => ({
  retrieveContextEnhanced: vi.fn().mockResolvedValue([
    {
      document: {
        content: "Chunk 1 content",
        metadata: {
          title: "Doc 1",
          source: "test.txt",
          type: "file",
          chunkIndex: 0,
          fileId: "file1"
        }
      },
      score: 0.9
    },
    {
      document: {
        content: "Chunk 2 content",
        metadata: {
          title: "Doc 1",
          source: "test.txt",
          type: "file",
          chunkIndex: 1,
          fileId: "file1"
        }
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

describe("retrieveContextFromSources", () => {
  it("returns empty context when sources array is empty", async () => {
    const result = await retrieveContextFromSources("query", [])

    expect(result).toEqual({ documents: [], formattedContext: "", sources: [] })
  })

  it("returns formatted results when embedding succeeds", async () => {
    const { generateEmbedding, generateEmbeddingsBatch } = await import(
      "@/lib/embeddings/embedding-client"
    )
    const { formatEnhancedResults } = await import("../rag-pipeline")

    vi.mocked(generateEmbedding).mockResolvedValueOnce({
      embedding: [0.1, 0.2],
      model: "test-model",
      providerId: "ollama"
    } as any)
    vi.mocked(generateEmbeddingsBatch).mockResolvedValueOnce([
      { embedding: [0.1, 0.2], model: "test-model", providerId: "ollama" }
    ] as any)

    const sources = [
      {
        id: "src-1",
        title: "Test Title",
        content: "Some content about the topic"
      }
    ]
    const result = await retrieveContextFromSources("test query", sources)

    expect(formatEnhancedResults).toHaveBeenCalled()
    expect(result).toHaveProperty("formattedContext")
    expect(result).toHaveProperty("documents")
    expect(result).toHaveProperty("sources")
    expect(result.formattedContext).not.toBe("")
  })

  it("falls back to keyword context when embedding fails", async () => {
    const { generateEmbedding } = await import(
      "@/lib/embeddings/embedding-client"
    )

    vi.mocked(generateEmbedding).mockResolvedValueOnce({ error: "failed" })

    const sources = [
      {
        id: "src-1",
        title: "Test Title",
        content: "keyword content for fallback"
      }
    ]
    const result = await retrieveContextFromSources("keyword", sources)

    expect(result).toHaveProperty("documents")
    expect(result).toHaveProperty("formattedContext")
    expect(result).toHaveProperty("sources")
  })
})

describe("reformulateQuestion", () => {
  const chatHistory = [
    { role: "user" as const, content: "Tell me about modules." },
    {
      role: "assistant" as const,
      content: "Modules are reusable units of code."
    }
  ]

  it("returns the reformulated question from modelInvokeFn", async () => {
    const modelInvokeFn = vi
      .fn()
      .mockResolvedValue("What is the purpose of this module?")

    const result = await reformulateQuestion(
      "What does it do?",
      chatHistory,
      modelInvokeFn
    )

    expect(result).toBe("What is the purpose of this module?")
    expect(modelInvokeFn).toHaveBeenCalledOnce()
  })

  it("returns original question when modelInvokeFn returns empty string", async () => {
    const modelInvokeFn = vi.fn().mockResolvedValue("")

    const result = await reformulateQuestion(
      "What does it do?",
      chatHistory,
      modelInvokeFn
    )

    expect(result).toBe("What does it do?")
  })

  it("uses questionPromptOverride instead of config when provided", async () => {
    const { knowledgeConfig } = await import("@/lib/config/knowledge-config")
    const modelInvokeFn = vi.fn().mockResolvedValue("Reformulated question")
    const overrideTemplate =
      "Custom history: {chat_history}\nCustom question: {question}"

    const result = await reformulateQuestion(
      "What does it do?",
      chatHistory,
      modelInvokeFn,
      overrideTemplate
    )

    expect(knowledgeConfig.getQuestionPrompt).not.toHaveBeenCalled()
    expect(modelInvokeFn).toHaveBeenCalledWith(
      expect.stringContaining("Custom history:")
    )
    expect(result).toBe("Reformulated question")
  })
})
