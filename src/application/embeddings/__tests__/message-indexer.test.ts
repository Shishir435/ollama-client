import { beforeEach, describe, expect, it, vi } from "vitest"
import { storeVector } from "@/lib/embeddings/storage"
import { getMessageForIndexing } from "@/lib/repositories/chat-history"
import {
  acknowledgeMessageIndexJob,
  listMessageIndexJobs
} from "@/lib/repositories/message-index-jobs"
import { readSetting } from "@/lib/storage/setting-access"
import { EmbeddingService } from "../embedding-service"
import { resumeMessageIndexing } from "../message-indexer"

vi.mock("../embedding-service", () => ({
  EmbeddingService: { generate: vi.fn() }
}))
vi.mock("@/lib/embeddings/chunker", () => ({
  chunkTextAsync: vi.fn(async () => [
    { text: "first chunk" },
    { text: "TAIL-CANARY" }
  ])
}))
vi.mock("@/lib/embeddings/config", () => ({
  getEmbeddingConfig: vi.fn(async () => ({}))
}))
vi.mock("@/lib/embeddings/content-quality-filter", () => ({
  assessContentQuality: vi.fn(() => ({
    shouldEmbed: true,
    score: 1,
    reasons: []
  }))
}))
vi.mock("@/lib/embeddings/message-revisions", () => ({
  messageRevision: vi.fn(async () => "revision"),
  activateMessageRevision: vi.fn(async () => true)
}))
vi.mock("@/lib/embeddings/storage", () => ({
  storeVector: vi.fn(async () => 1)
}))
vi.mock("@/lib/repositories/chat-history", () => ({
  getMessageForIndexing: vi.fn()
}))
vi.mock("@/lib/repositories/message-index-jobs", () => ({
  listMessageIndexJobs: vi.fn(),
  acknowledgeMessageIndexJob: vi.fn(),
  queueMessageIndexJobs: vi.fn()
}))
vi.mock("@/lib/storage/setting-access", () => ({
  readSetting: vi.fn(async () => true)
}))

const job = { messageId: 7, token: "job-token" }
const embedding = { embedding: [1, 0], model: "local", providerId: "ollama" }
describe("background message indexing recovery", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(readSetting).mockResolvedValue(true as never)
    vi.mocked(getMessageForIndexing).mockResolvedValue({
      revision: "revision",
      token: "index-token",
      message: {
        id: 7,
        sessionId: "chat",
        role: "user",
        content: "A long message with a tail",
        timestamp: 1,
        done: true
      }
    })
    vi.mocked(listMessageIndexJobs).mockResolvedValue([])
    vi.mocked(EmbeddingService.generate).mockResolvedValue(embedding)
  })
  it("leaves a failed tail job pending and retries every chunk with the same identity", async () => {
    vi.mocked(listMessageIndexJobs).mockResolvedValueOnce([job])
    vi.mocked(EmbeddingService.generate)
      .mockResolvedValueOnce(embedding)
      .mockResolvedValueOnce({ error: "offline" })
    await expect(resumeMessageIndexing()).rejects.toThrow(/retried/)
    expect(acknowledgeMessageIndexJob).not.toHaveBeenCalled()
    vi.mocked(listMessageIndexJobs).mockResolvedValueOnce([job])
    await resumeMessageIndexing()
    expect(acknowledgeMessageIndexJob).toHaveBeenCalledWith(job)
    const writes = vi.mocked(storeVector).mock.calls
    expect(writes.map(([content]) => content)).toEqual([
      "first chunk",
      "first chunk",
      "TAIL-CANARY"
    ])
    expect(writes[0][2]).toEqual(writes[1][2])
    expect(writes[2][2]).toMatchObject({
      messageId: 7,
      messageRevision: "revision",
      chunkIndex: 1,
      totalChunks: 2
    })
  })
  it("continues past a rejected job and later batches without acknowledging the failed job", async () => {
    const newer = { messageId: 50, token: "newer" }
    const last = { messageId: 100, token: "last" }
    vi.mocked(listMessageIndexJobs)
      .mockResolvedValueOnce([job, newer])
      .mockResolvedValueOnce([last])
    vi.mocked(EmbeddingService.generate).mockResolvedValueOnce({
      error: "one chunk rejected"
    })
    await expect(resumeMessageIndexing()).rejects.toThrow(/retried/)
    expect(acknowledgeMessageIndexJob).not.toHaveBeenCalledWith(job)
    expect(acknowledgeMessageIndexJob).toHaveBeenCalledWith(newer)
    expect(acknowledgeMessageIndexJob).toHaveBeenCalledWith(last)
    expect(listMessageIndexJobs).toHaveBeenCalledWith(50)
    expect(listMessageIndexJobs).toHaveBeenCalledWith(100)
  })
  it("does no indexing when memory is disabled", async () => {
    vi.mocked(readSetting).mockResolvedValue(false as never)
    await resumeMessageIndexing()
    expect(listMessageIndexJobs).not.toHaveBeenCalled()
    expect(EmbeddingService.generate).not.toHaveBeenCalled()
  })
  it("keeps the durable job when indexing is aborted during embedding", async () => {
    const controller = new AbortController()
    vi.mocked(listMessageIndexJobs).mockResolvedValueOnce([job])
    vi.mocked(EmbeddingService.generate).mockImplementationOnce(async () => {
      controller.abort()
      return embedding
    })
    await expect(
      resumeMessageIndexing(controller.signal)
    ).rejects.toMatchObject({ name: "AbortError" })
    expect(storeVector).not.toHaveBeenCalled()
    expect(acknowledgeMessageIndexJob).not.toHaveBeenCalled()
  })
})
