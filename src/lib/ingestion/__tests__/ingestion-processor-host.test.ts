import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  payloads: new Map<string, unknown>(),
  processFile: vi.fn()
}))

vi.mock("@/lib/ingestion/ingestion-payload-db", () => ({
  ingestionPayloadDb: {
    payloads: {
      get: vi.fn(async (id: string) => mocks.payloads.get(id)),
      put: vi.fn(async (payload: { jobId: string }) => {
        mocks.payloads.set(payload.jobId, payload)
      })
    }
  }
}))

vi.mock("@/lib/file-processors", () => ({
  processFile: mocks.processFile
}))

import { processStagedIngestionPayload } from "../ingestion-processor-host"

describe("ingestion processor host", () => {
  beforeEach(() => {
    mocks.payloads.clear()
    vi.clearAllMocks()
  })

  it("parses durable bytes and replaces them with a processed payload", async () => {
    const jobId = "00000000-0000-4000-8000-000000000020"
    mocks.payloads.set(jobId, {
      kind: "raw",
      jobId,
      fileId: "file-20",
      knowledgeSetId: "knowledge-default",
      fileName: "notes.txt",
      contentType: "text/plain",
      autoEmbed: true,
      createdAt: 10,
      bytes: new TextEncoder().encode("raw text").buffer,
      lastModified: 5
    })
    mocks.processFile.mockResolvedValue({
      text: "processed text",
      metadata: {
        fileName: "notes.txt",
        fileType: "text/plain",
        fileSize: 8,
        processedAt: 20
      }
    })

    await processStagedIngestionPayload(jobId)

    expect(mocks.processFile).toHaveBeenCalledWith(
      expect.objectContaining({ name: "notes.txt", type: "text/plain" })
    )
    expect(mocks.payloads.get(jobId)).toMatchObject({
      kind: "processed",
      processedFile: {
        text: "processed text",
        metadata: {
          fileId: "file-20",
          knowledgeSetId: "knowledge-default"
        }
      }
    })
  })
})
