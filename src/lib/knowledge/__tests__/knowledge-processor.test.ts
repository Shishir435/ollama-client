import { describe, expect, it, vi } from "vitest"

import {
  processKnowledge,
  processKnowledgeBatch
} from "../knowledge-processor"
import * as vectorStore from "@/lib/embeddings/vector-store"
import * as textProcessing from "@/lib/text-processing"

// Mock dependencies
vi.mock("@/lib/embeddings/vector-store")
vi.mock("@/lib/text-processing")

describe("processKnowledge", () => {
  const mockSplitter = {
    splitDocuments: vi.fn().mockResolvedValue([
      { pageContent: "chunk1", metadata: {} },
      { pageContent: "chunk2", metadata: {} }
    ])
  }

  it("processes document successfully", async () => {
    vi.mocked(textProcessing.getTextSplitter).mockResolvedValue(mockSplitter as any)
    vi.mocked(vectorStore.fromDocuments).mockResolvedValue({ vectorIds: [1, 2] })

    const onProgress = vi.fn()
    const result = await processKnowledge({
      fileId: "file1",
      fileName: "test.txt",
      content: "content",
      contentType: "text/plain",
      onProgress
    })

    expect(result.success).toBe(true)
    expect(result.chunkCount).toBe(2)
    expect(mockSplitter.splitDocuments).toHaveBeenCalled()
    expect(vectorStore.fromDocuments).toHaveBeenCalled()
    expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({ status: "processing" }))
    expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({ status: "completed" }))
  })

  it("handles errors gracefully", async () => {
    vi.mocked(textProcessing.getTextSplitter).mockRejectedValue(new Error("Split error"))

    const onProgress = vi.fn()
    const result = await processKnowledge({
      fileId: "file1",
      fileName: "test.txt",
      content: "content",
      contentType: "text/plain",
      onProgress
    })

    expect(result.success).toBe(false)
    expect(result.error).toBe("Split error")
    expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({ status: "error" }))
  })
})

describe("processKnowledgeBatch", () => {
  it("processes multiple files", async () => {
    // Mock successful processing for both files
    // We can't easily mock processKnowledge directly since it's in the same module
    // But we can rely on the mocked dependencies behaving correctly
    const mockSplitter = {
      splitDocuments: vi.fn().mockResolvedValue([{ pageContent: "chunk", metadata: {} }])
    }
    vi.mocked(textProcessing.getTextSplitter).mockResolvedValue(mockSplitter as any)
    vi.mocked(vectorStore.fromDocuments).mockResolvedValue({ vectorIds: [1] })

    const files = [
      { fileId: "f1", fileName: "1.txt", content: "c1", contentType: "txt" },
      { fileId: "f2", fileName: "2.txt", content: "c2", contentType: "txt" }
    ]

    const onProgress = vi.fn()
    const results = await processKnowledgeBatch(files, onProgress)

    expect(results.size).toBe(2)
    expect(results.get("f1")?.success).toBe(true)
    expect(results.get("f2")?.success).toBe(true)
    expect(textProcessing.getTextSplitter).toHaveBeenCalledTimes(2)
  })
})
