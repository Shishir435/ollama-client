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
  processStaged: vi.fn(),
  readPayloads: vi.fn()
}))

vi.mock("@/lib/repositories/ingestion-runs", () => ({
  saveIngestionRun: vi.fn(async (run: IngestionRun) => {
    mocks.runs.set(run.id, { ...run })
  }),
  getIngestionRun: vi.fn(async (id: string) => mocks.runs.get(id) ?? null),
  hasIngestionRun: vi.fn(async (id: string) => mocks.runs.has(id)),
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
      toArray: mocks.readPayloads,
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

import {
  hasIngestionRun,
  saveIngestionRun
} from "@/lib/repositories/ingestion-runs"
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
    mocks.readPayloads.mockImplementation(async () => [
      ...mocks.payloads.values()
    ])
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

  it("keeps staging and releases admission after an ownership check fails", async () => {
    const request = stageRequest()
    vi.mocked(hasIngestionRun).mockRejectedValueOnce(
      new Error("Owner unavailable")
    )
    await expect(
      IngestionService.acknowledge(request.jobId, true)
    ).rejects.toThrow("Owner unavailable")
    expect(mocks.payloads.has(request.jobId)).toBe(true)
    await IngestionService.submit(request)
    await vi.waitFor(() =>
      expect(mocks.runs.get(request.jobId)?.status).toBe("completed")
    )
    expect(mocks.processKnowledge).toHaveBeenCalledOnce()
  })

  it("keeps input when startup owns admission before page cleanup", async () => {
    const request = stageRequest()
    let claimed!: () => void
    const admitting = new Promise<void>((resolve) => {
      claimed = resolve
    })
    let finishClaim!: () => void
    const holdClaim = new Promise<void>((resolve) => {
      finishClaim = resolve
    })
    vi.mocked(saveIngestionRun).mockImplementationOnce(async (run) => {
      claimed()
      await holdClaim
      mocks.runs.set(run.id, { ...run })
    })
    const recovery = IngestionService.resumeIncomplete()
    await admitting
    const cleanup = IngestionService.acknowledge(request.jobId, true)
    expect(mocks.payloads.has(request.jobId)).toBe(true)
    finishClaim()
    await expect(cleanup).resolves.toEqual({
      jobId: request.jobId,
      released: false
    })
    await recovery
    expect(mocks.payloads.has(request.jobId)).toBe(true)
    expect(mocks.runs.get(request.jobId)?.status).toBe("completed")
    expect(mocks.processKnowledge).toHaveBeenCalledOnce()
  })

  it("does not admit a stale startup snapshot after cleanup wins", async () => {
    const request = stageRequest()
    let scanned!: () => void
    const scanning = new Promise<void>((resolve) => {
      scanned = resolve
    })
    let finishScan!: () => void
    const holdScan = new Promise<void>((resolve) => {
      finishScan = resolve
    })
    mocks.readPayloads.mockImplementationOnce(async () => {
      const snapshot = [...mocks.payloads.values()]
      scanned()
      await holdScan
      return snapshot
    })
    const recovery = IngestionService.resumeIncomplete()
    await scanning
    await expect(
      IngestionService.acknowledge(request.jobId, true)
    ).resolves.toEqual({ jobId: request.jobId, released: true })
    finishScan()
    await recovery
    expect(mocks.runs.has(request.jobId)).toBe(false)
    expect(mocks.payloads.has(request.jobId)).toBe(false)
    expect(mocks.processKnowledge).not.toHaveBeenCalled()
  })

  it("preserves owned input even when its run checkpoint cannot decode", async () => {
    const request = stageRequest()
    vi.mocked(hasIngestionRun).mockResolvedValueOnce(true)
    await expect(
      IngestionService.acknowledge(request.jobId, true)
    ).resolves.toEqual({ jobId: request.jobId, released: false })
    expect(mocks.payloads.has(request.jobId)).toBe(true)
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
    // The result survives reads until the caller acknowledges it.
    expect(mocks.payloads.has(submitted.jobId)).toBe(true)
  })

  it("keeps page-aware text in the host while returning only the UI text", async () => {
    const submitted = await IngestionService.submit(stageRequest())
    await vi.waitFor(async () =>
      expect((await IngestionService.get(submitted.jobId)).status).toBe(
        "completed"
      )
    )
    const payload = mocks.payloads.get(submitted.jobId) as any
    payload.processedFile.pages = [{ pageNumber: 1, text: "page text" }]
    const result = await IngestionService.get(submitted.jobId)
    expect(result.processedFile?.text).toBe("durable content")
    expect(result.processedFile).not.toHaveProperty("pages")
    expect(payload.processedFile.pages).toEqual([
      { pageNumber: 1, text: "page text" }
    ])
  })

  it("keeps a completed result readable until it is acknowledged", async () => {
    const submitted = await IngestionService.submit(stageRequest())
    await vi.waitFor(async () => {
      await expect(
        IngestionService.get(submitted.jobId)
      ).resolves.toMatchObject({ status: "completed" })
    })

    // Simulates a dropped `ingestions.get` response: the caller re-reads and
    // still gets the parse result.
    await expect(IngestionService.get(submitted.jobId)).resolves.toMatchObject({
      status: "completed",
      processedFile: { text: "durable content" }
    })

    await expect(
      IngestionService.acknowledge(submitted.jobId)
    ).resolves.toEqual({
      jobId: submitted.jobId,
      released: true
    })
    expect(mocks.payloads.has(submitted.jobId)).toBe(false)
  })

  it("refuses to release the payload of a job that is still running", async () => {
    const run: IngestionRun = {
      id: "2f2b2f0c-2a7a-4a1e-9d61-2b0d7a5f0c11",
      fileId: "file-live",
      knowledgeSetId: "default",
      fileName: "live.txt",
      status: "running",
      phase: "embedding",
      autoEmbed: false,
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
      autoEmbed: false,
      createdAt: 1,
      processedFile
    })

    await expect(IngestionService.acknowledge(run.id)).resolves.toEqual({
      jobId: run.id,
      released: false
    })
    expect(mocks.payloads.has(run.id)).toBe(true)
  })

  it("prunes a completed payload that was never acknowledged", async () => {
    const jobId = "3a3b3f0c-2a7a-4a1e-9d61-2b0d7a5f0c22"
    const run: IngestionRun = {
      id: jobId,
      fileId: "file-stale",
      knowledgeSetId: "default",
      fileName: "stale.txt",
      status: "completed",
      phase: "completed",
      autoEmbed: false,
      createdAt: 1,
      updatedAt: Date.now() - 48 * 60 * 60 * 1000
    }
    mocks.runs.set(jobId, run)
    mocks.payloads.set(jobId, {
      kind: "processed",
      jobId,
      fileId: run.fileId,
      knowledgeSetId: "default",
      fileName: run.fileName,
      contentType: "text/plain",
      autoEmbed: false,
      createdAt: run.createdAt,
      processedFile
    })

    await IngestionService.resumeIncomplete()

    expect(mocks.payloads.has(jobId)).toBe(false)
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

  it("stops startup recovery without terminally cancelling the durable job", async () => {
    const run: IngestionRun = {
      id: "1a0c83a6-e6df-4cd3-9168-709ee9759940",
      fileId: "file-interrupted",
      knowledgeSetId: "default",
      fileName: "interrupted.txt",
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
      processedFile
    })
    mocks.processKnowledge.mockImplementationOnce(
      async ({ signal }: { signal: AbortSignal }) =>
        new Promise((_, reject) => {
          signal.addEventListener(
            "abort",
            () => reject(new DOMException("Stopped", "AbortError")),
            { once: true }
          )
        })
    )
    const controller = new AbortController()

    const recovery = IngestionService.resumeIncomplete(controller.signal)
    await vi.waitFor(() =>
      expect(mocks.processKnowledge).toHaveBeenCalledOnce()
    )
    controller.abort()
    await expect(recovery).rejects.toMatchObject({ name: "AbortError" })

    expect(mocks.runs.get(run.id)).toMatchObject({
      status: "running",
      phase: "embedding"
    })
    expect(mocks.removeFile).not.toHaveBeenCalled()
    expect(mocks.payloads.has(run.id)).toBe(true)
  })

  it("does not let recovery cancel an ingestion already owned by submit", async () => {
    let finishEmbedding: () => void = () => undefined
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
    const submitted = await IngestionService.submit(stageRequest())
    await vi.waitFor(() =>
      expect(mocks.processKnowledge).toHaveBeenCalledOnce()
    )
    const controller = new AbortController()

    const recovery = IngestionService.resumeIncomplete(controller.signal)
    controller.abort()
    await Promise.resolve()

    await expect(IngestionService.get(submitted.jobId)).resolves.toMatchObject({
      status: "running",
      phase: "embedding"
    })
    expect(mocks.removeFile).not.toHaveBeenCalled()
    expect(mocks.payloads.has(submitted.jobId)).toBe(true)

    finishEmbedding()
    await expect(recovery).rejects.toMatchObject({ name: "AbortError" })
    await expect(IngestionService.get(submitted.jobId)).resolves.toMatchObject({
      status: "completed",
      phase: "completed"
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
