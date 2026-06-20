import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ProcessedFile } from "@/lib/file-processors/types"
import {
  ensureProcessedFileId,
  registerKnowledgeFile,
  validateFileForUpload
} from "../file-upload-pipeline"

const knowledge = vi.hoisted(() => ({
  addFileToKnowledgeSet: vi.fn(),
  getActiveKnowledgeSetId: vi.fn()
}))

vi.mock("@/lib/knowledge/knowledge-sets", () => knowledge)

describe("file-upload-pipeline", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    knowledge.getActiveKnowledgeSetId.mockResolvedValue("knowledge-default")
  })

  it("rejects files above the configured size", () => {
    const file = new File(["hello"], "note.txt", { type: "text/plain" })

    const error = validateFileForUpload(file, 1)

    expect(error?.message).toContain("exceeds maximum size")
  })

  it("keeps existing processed file ids", () => {
    const result = {
      text: "hello",
      metadata: {
        fileId: "existing-id",
        fileName: "note.txt",
        fileType: "text/plain",
        fileSize: 5,
        processedAt: 1
      }
    } as ProcessedFile

    expect(ensureProcessedFileId(result)).toBe("existing-id")
    expect(result.metadata.fileId).toBe("existing-id")
  })

  it("registers processed files with the active knowledge set", async () => {
    const result = {
      text: "hello",
      metadata: {
        fileName: "note.txt",
        fileType: "text/plain",
        fileSize: 5,
        processedAt: 123
      }
    } as ProcessedFile

    await registerKnowledgeFile(result, "file-1")

    expect(result.metadata.knowledgeSetId).toBe("knowledge-default")
    expect(knowledge.addFileToKnowledgeSet).toHaveBeenCalledWith({
      id: "file-1",
      knowledgeSetId: "knowledge-default",
      fileName: "note.txt",
      fileType: "text/plain",
      fileSize: 5,
      createdAt: 123
    })
  })
})
