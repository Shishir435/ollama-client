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

import { durableFileText } from "../durable-processed-file"
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
      expect.objectContaining({ name: "notes.txt", type: "text/plain" }),
      undefined
    )
    expect(mocks.payloads.get(jobId)).not.toHaveProperty("bytes")
    expect(mocks.payloads.get(jobId)).not.toHaveProperty("lastModified")
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

  it("stores a paged file by its pages and leaves its text to be rebuilt", async () => {
    const jobId = "00000000-0000-4000-8000-000000000021"
    mocks.payloads.set(jobId, {
      kind: "raw",
      jobId,
      fileId: "file-21",
      knowledgeSetId: "knowledge-default",
      fileName: "paper.pdf",
      contentType: "application/pdf",
      autoEmbed: true,
      createdAt: 10,
      bytes: new ArrayBuffer(4),
      lastModified: 5
    })
    mocks.processFile.mockResolvedValue({
      text: "--- Page 3 ---\nthree",
      pages: [{ pageNumber: 3, text: "three" }],
      metadata: {
        fileName: "paper.pdf",
        fileType: "application/pdf",
        fileSize: 4,
        processedAt: 20
      }
    })

    await processStagedIngestionPayload(jobId)

    const stored = mocks.payloads.get(jobId) as {
      processedFile: Record<string, unknown>
    }
    expect(stored.processedFile).not.toHaveProperty("text")
    expect(stored.processedFile.pages).toEqual([
      { pageNumber: 3, text: "three" }
    ])
    expect(durableFileText(stored.processedFile as never)).toBe(
      "--- Page 3 ---\nthree"
    )
  })

  it("passes the cancel signal to the parser and stores nothing once it fires", async () => {
    const jobId = "00000000-0000-4000-8000-000000000022"
    mocks.payloads.set(jobId, {
      kind: "raw",
      jobId,
      fileId: "file-22",
      knowledgeSetId: "knowledge-default",
      fileName: "paper.pdf",
      contentType: "application/pdf",
      autoEmbed: true,
      createdAt: 10,
      bytes: new ArrayBuffer(4),
      lastModified: 5
    })
    const controller = new AbortController()
    mocks.processFile.mockImplementation(async () => {
      controller.abort()
      return { text: "late", metadata: {} }
    })

    await expect(
      processStagedIngestionPayload(jobId, controller.signal)
    ).rejects.toThrow()

    expect(mocks.processFile).toHaveBeenCalledWith(
      expect.anything(),
      controller.signal
    )
    expect(mocks.payloads.get(jobId)).toMatchObject({ kind: "raw" })
  })
})
