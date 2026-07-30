import { beforeEach, describe, expect, it, vi } from "vitest"
import type { IngestionRun } from "@/lib/repositories/ingestion-runs"

const mocks = vi.hoisted(() => ({
  runs: new Map<string, IngestionRun>(),
  payloads: new Map<string, unknown>(),
  addFile: vi.fn(),
  markEmbedded: vi.fn(),
  removeFile: vi.fn(),
  deleteVectors: vi.fn(),
  processKnowledge: vi.fn(),
  processFile: vi.fn(),
  processStaged: vi.fn()
}))

vi.mock("@/lib/repositories/ingestion-runs", () => ({
  saveIngestionRun: vi.fn(async (run: IngestionRun) => {
    mocks.runs.set(run.id, { ...run })
  }),
  getIngestionRun: vi.fn(async (id: string) => mocks.runs.get(id) ?? null),
  listIncompleteIngestionRuns: vi.fn(async () =>
    [...mocks.runs.values()].filter(
      (run) => run.status === "queued" || run.status === "running"
    )
  )
}))

vi.mock("@/lib/ingestion/ingestion-payload-db", () => ({
  ingestionPayloadDb: {
    payloads: {
      put: vi.fn(async (payload: { jobId: string }) => {
        mocks.payloads.set(payload.jobId, payload)
      }),
      get: vi.fn(async (id: string) => mocks.payloads.get(id)),
      toArray: vi.fn(async () => [...mocks.payloads.values()]),
      delete: vi.fn(async (id: string) => {
        mocks.payloads.delete(id)
      })
    }
  }
}))

vi.mock("@/lib/knowledge/knowledge-sets", () => ({
  addFileToKnowledgeSet: mocks.addFile,
  markKnowledgeFileEmbedded: mocks.markEmbedded,
  removeKnowledgeFile: mocks.removeFile
}))

vi.mock("@/lib/embeddings/vector-store", () => ({
  deleteVectors: mocks.deleteVectors
}))

vi.mock("@/lib/knowledge/knowledge-processor", () => ({
  processKnowledge: mocks.processKnowledge
}))

vi.mock("@/lib/file-processors", () => ({
  processFile: mocks.processFile
}))

vi.mock("@/lib/ingestion/ingestion-processor-protocol", () => ({
  processStagedIngestion: mocks.processStaged
}))

import { IngestionService } from "../ingestion-service"

const processedFile = {
  text: "durable content",
  metadata: {
    fileName: "notes.txt",
    fileType: "text/plain",
    fileSize: 15,
    processedAt: 100,
    fileId: "file-1",
    knowledgeSetId: "default"
  }
}

let jobSequence = 0
const stageRequest = (fileId = "file-1") => {
  jobSequence += 1
  const jobId = `00000000-0000-4000-8000-${jobSequence
    .toString()
    .padStart(12, "0")}`
  mocks.payloads.set(jobId, {
    kind: "processed",
    jobId,
    fileId,
    knowledgeSetId: "default",
    fileName: "notes.txt",
    contentType: "text/plain",
    autoEmbed: true,
    createdAt: 100,
    processedFile: {
      ...processedFile,
      metadata: { ...processedFile.metadata, fileId }
    }
  })
  return { jobId }
}

describe("IngestionService", () => {
  beforeEach(() => {
    jobSequence = 0
    mocks.runs.clear()
    mocks.payloads.clear()
    vi.clearAllMocks()
    mocks.addFile.mockResolvedValue(undefined)
    mocks.markEmbedded.mockResolvedValue(undefined)
    mocks.removeFile.mockResolvedValue(undefined)
    mocks.deleteVectors.mockResolvedValue(0)
    mocks.processKnowledge.mockResolvedValue({
      success: true,
      vectorIds: [1],
      chunkCount: 1
    })
    mocks.processFile.mockResolvedValue({
      text: "parsed in background",
      metadata: {
        fileName: "raw.txt",
        fileType: "text/plain",
        fileSize: 16,
        processedAt: 200
      }
    })
    mocks.processStaged.mockImplementation(async (jobId: string) => {
      const payload = mocks.payloads.get(jobId) as
        | {
            kind: "raw"
            fileId: string
            knowledgeSetId: string
          }
        | undefined
      if (payload?.kind !== "raw") return
      const parsed = await mocks.processFile()
      mocks.payloads.set(jobId, {
        ...payload,
        kind: "processed",
        processedFile: {
          ...parsed,
          metadata: {
            ...parsed.metadata,
            fileId: payload.fileId,
            knowledgeSetId: payload.knowledgeSetId
          }
        }
      })
    })
  })

  it("checkpoints ownership before processing and completes the saga", async () => {
    const submitted = await IngestionService.submit(stageRequest())

    expect(submitted).toMatchObject({
      fileId: "file-1",
      status: "queued",
      phase: "queued"
    })
    expect(mocks.payloads.has(submitted.jobId)).toBe(true)

    await vi.waitFor(async () => {
      await expect(
        IngestionService.get(submitted.jobId)
      ).resolves.toMatchObject({
        status: "completed",
        phase: "completed"
      })
    })

    expect(mocks.addFile).toHaveBeenCalledOnce()
    expect(mocks.deleteVectors).toHaveBeenCalledWith({ fileId: "file-1" })
    expect(mocks.markEmbedded).toHaveBeenCalledWith("file-1")
    expect(mocks.payloads.has(submitted.jobId)).toBe(false)
  })

  it("compensates metadata and partial vectors when embedding fails", async () => {
    mocks.processKnowledge.mockResolvedValueOnce({
      success: false,
      vectorIds: [],
      chunkCount: 0,
      error: "provider unavailable"
    })

    const submitted = await IngestionService.submit(stageRequest())
    await vi.waitFor(async () => {
      await expect(
        IngestionService.get(submitted.jobId)
      ).resolves.toMatchObject({
        status: "failed",
        phase: "completed",
        failure: "provider unavailable"
      })
    })

    expect(mocks.removeFile).toHaveBeenCalledWith("file-1")
    expect(mocks.deleteVectors).toHaveBeenCalledTimes(2)
  })

  it("replays an interrupted embedding phase from a clean partition", async () => {
    const run: IngestionRun = {
      id: "f264387d-df5b-4c83-a535-cf25056f09db",
      fileId: "file-replay",
      knowledgeSetId: "default",
      fileName: "replay.txt",
      status: "running",
      phase: "embedding",
      autoEmbed: true,
      createdAt: 1,
      updatedAt: 2
    }
    mocks.runs.set(run.id, run)
    mocks.payloads.set(run.id, {
      kind: "processed",
      jobId: run.id,
      fileId: run.fileId,
      knowledgeSetId: run.knowledgeSetId,
      fileName: run.fileName,
      contentType: "text/plain",
      autoEmbed: true,
      createdAt: run.createdAt,
      processedFile: {
        ...processedFile,
        metadata: {
          ...processedFile.metadata,
          fileId: run.fileId,
          fileName: run.fileName
        }
      }
    })

    await IngestionService.resumeIncomplete()
    await vi.waitFor(async () => {
      await expect(IngestionService.get(run.id)).resolves.toMatchObject({
        status: "completed"
      })
    })

    expect(mocks.deleteVectors).toHaveBeenCalledWith({
      fileId: "file-replay"
    })
  })

  it("recovers and parses a staged raw file without a submitted receipt", async () => {
    const jobId = "00000000-0000-4000-8000-000000000099"
    mocks.payloads.set(jobId, {
      kind: "raw",
      jobId,
      fileId: "file-raw",
      knowledgeSetId: "default",
      fileName: "raw.txt",
      contentType: "text/plain",
      autoEmbed: true,
      createdAt: 100,
      bytes: new TextEncoder().encode("parsed in background").buffer,
      lastModified: 50
    })

    await IngestionService.resumeIncomplete()
    await vi.waitFor(async () => {
      await expect(IngestionService.get(jobId)).resolves.toMatchObject({
        status: "completed",
        phase: "completed",
        processedFile: {
          text: "parsed in background",
          metadata: {
            fileId: "file-raw",
            knowledgeSetId: "default"
          }
        }
      })
    })

    expect(mocks.processStaged).toHaveBeenCalledWith(jobId)
  })

  it("cancels a sibling run before file-scoped cleanup can collide", async () => {
    let finishEmbedding!: () => void
    mocks.processKnowledge.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishEmbedding = () =>
            resolve({
              success: true,
              vectorIds: [1],
              chunkCount: 1
            })
        })
    )

    const first = await IngestionService.submit(stageRequest())
    await vi.waitFor(() => {
      expect(mocks.processKnowledge).toHaveBeenCalledOnce()
    })

    const sibling = await IngestionService.submit(stageRequest())
    await vi.waitFor(async () => {
      await expect(IngestionService.get(sibling.jobId)).resolves.toMatchObject({
        status: "cancelled",
        phase: "completed"
      })
    })

    expect(mocks.processKnowledge).toHaveBeenCalledOnce()
    expect(mocks.deleteVectors).toHaveBeenCalledOnce()
    expect(mocks.removeFile).not.toHaveBeenCalled()

    finishEmbedding()
    await vi.waitFor(async () => {
      await expect(IngestionService.get(first.jobId)).resolves.toMatchObject({
        status: "completed",
        phase: "completed"
      })
    })

    expect(mocks.deleteVectors).toHaveBeenCalledOnce()
  })
})
