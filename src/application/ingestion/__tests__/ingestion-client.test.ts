import { RpcMethod } from "@ollama-client/contracts/rpc"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ingestionPayloadDb } from "@/lib/ingestion/ingestion-payload-db"
import { extensionRpcClient } from "@/protocol/extension-client"

vi.mock("@/lib/knowledge/knowledge-sets", () => ({
  getActiveKnowledgeSetId: vi.fn().mockResolvedValue("knowledge-default")
}))

vi.mock("@/protocol/extension-client", () => ({
  extensionRpcClient: {
    call: vi.fn()
  }
}))

import { IngestionClient, IngestionObservationError } from "../ingestion-client"

afterEach(() => vi.useRealTimers())

describe("IngestionClient", () => {
  it("removes staging and sends no submission when the page aborts during the staging write", async () => {
    const controller = new AbortController()
    const originalPut = ingestionPayloadDb.payloads.put.bind(
      ingestionPayloadDb.payloads
    )
    const stagedPut = vi
      .spyOn(ingestionPayloadDb.payloads, "put")
      .mockImplementation((payload) =>
        originalPut(payload).then((result) => {
          controller.abort()
          return result
        })
      )
    try {
      await expect(
        IngestionClient.submitFile(
          new File(["text"], "notes.txt", { type: "text/plain" }),
          { autoEmbed: false, signal: controller.signal }
        )
      ).rejects.toMatchObject({ name: "AbortError" })
      expect(extensionRpcClient.call).not.toHaveBeenCalled()
      expect(await ingestionPayloadDb.payloads.count()).toBe(0)
    } finally {
      stagedPut.mockRestore()
    }
  })

  it("keeps staged bytes after a lost submission acknowledgement", async () => {
    vi.mocked(extensionRpcClient.call).mockRejectedValueOnce(
      new Error("worker disconnected")
    )
    await expect(
      IngestionClient.submitFile(
        new File(["text"], "notes.txt", { type: "text/plain" }),
        { autoEmbed: false }
      )
    ).rejects.toThrow("worker disconnected")
    expect(await ingestionPayloadDb.payloads.count()).toBe(1)
  })

  it("ends observation at its deadline while leaving durable work alone", async () => {
    vi.useFakeTimers()
    vi.mocked(extensionRpcClient.call).mockResolvedValue({
      jobId: "job-1",
      fileId: "file-1",
      status: "running",
      phase: "embedding"
    } as never)
    const check = expect(
      IngestionClient.observe("job-1")
    ).rejects.toMatchObject({ jobId: "job-1" })
    await vi.advanceTimersByTimeAsync(30 * 60_000)
    await check
    expect(vi.getTimerCount()).toBe(0)
    expect(
      vi
        .mocked(extensionRpcClient.call)
        .mock.calls.every(([method]) => method === RpcMethod.IngestionGet)
    ).toBe(true)
  })

  it("reconnects after a transient poll failure with adaptive intervals", async () => {
    vi.useFakeTimers()
    const job = {
      jobId: "job-1",
      fileId: "file-1",
      status: "running",
      phase: "embedding"
    }
    vi.mocked(extensionRpcClient.call)
      .mockResolvedValueOnce(job as never)
      .mockRejectedValueOnce(new Error("worker restarting"))
      .mockResolvedValueOnce(job as never)
      .mockResolvedValueOnce({ ...job, status: "completed" } as never)
    const pending = IngestionClient.observe("job-1")
    await vi.advanceTimersByTimeAsync(249)
    expect(extensionRpcClient.call).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(extensionRpcClient.call).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(500)
    expect(extensionRpcClient.call).toHaveBeenCalledTimes(3)
    await vi.advanceTimersByTimeAsync(750)
    expect((await pending).status).toBe("completed")
    expect(
      vi
        .mocked(extensionRpcClient.call)
        .mock.calls.every(([method]) => method === RpcMethod.IngestionGet)
    ).toBe(true)
  })

  it("aborts observation without cancelling or acknowledging the durable job", async () => {
    vi.useFakeTimers()
    vi.mocked(extensionRpcClient.call).mockResolvedValue({
      jobId: "job-1",
      fileId: "file-1",
      status: "running",
      phase: "embedding"
    } as never)
    const controller = new AbortController()
    const pending = IngestionClient.observe("job-1", {
      signal: controller.signal
    })
    const check = expect(pending).rejects.toMatchObject({ name: "AbortError" })
    await vi.advanceTimersByTimeAsync(1)
    controller.abort()
    await check
    await vi.advanceTimersByTimeAsync(10_000)
    expect(extensionRpcClient.call).toHaveBeenCalledTimes(1)
  })

  it("bounds failed observation and retains the reconnect id", async () => {
    vi.useFakeTimers()
    vi.mocked(extensionRpcClient.call)
      .mockResolvedValueOnce({
        jobId: "job-1",
        fileId: "file-1",
        status: "running",
        phase: "embedding"
      } as never)
      .mockRejectedValue(new Error("unavailable"))
    const check = expect(
      IngestionClient.observe("job-1")
    ).rejects.toMatchObject(new IngestionObservationError("job-1"))
    await vi.advanceTimersByTimeAsync(60_000)
    await check
    expect(extensionRpcClient.call).toHaveBeenCalledTimes(9)
    expect(vi.getTimerCount()).toBe(0)
  })

  beforeEach(async () => {
    vi.clearAllMocks()
    await ingestionPayloadDb.payloads.clear()
  })

  it("durably stages the raw file before submitting background parsing", async () => {
    const processedFile = {
      text: "background parsed text",
      metadata: {
        fileName: "notes.txt",
        fileType: "text/plain",
        fileSize: 8,
        processedAt: 20,
        fileId: "file-result",
        knowledgeSetId: "knowledge-default"
      }
    }

    vi.mocked(extensionRpcClient.call).mockImplementation(
      async (method, request) => {
        const ingestionRequest = request as { jobId: string }
        if (method === RpcMethod.IngestionSubmit) {
          const payload = await ingestionPayloadDb.payloads.get(
            ingestionRequest.jobId
          )
          expect(payload).toMatchObject({
            kind: "raw",
            jobId: ingestionRequest.jobId,
            fileName: "notes.txt",
            contentType: "text/plain",
            knowledgeSetId: "knowledge-default"
          })
          expect(
            payload?.kind === "raw" && new TextDecoder().decode(payload.bytes)
          ).toBe("raw text")
          return {
            jobId: ingestionRequest.jobId,
            fileId: payload?.fileId || "missing",
            status: "queued",
            phase: "queued"
          } as never
        }
        return {
          jobId: ingestionRequest.jobId,
          fileId: "file-result",
          status: "completed",
          phase: "completed",
          processedFile
        } as never
      }
    )

    const result = await IngestionClient.submitFile(
      new File(["raw text"], "notes.txt", { type: "text/plain" }),
      { autoEmbed: true }
    )

    expect(result).toEqual(processedFile)
    expect(extensionRpcClient.call).toHaveBeenNthCalledWith(
      1,
      RpcMethod.IngestionSubmit,
      expect.objectContaining({
        jobId: expect.any(String)
      })
    )
    // The staged copy is released only after the result was received.
    expect(extensionRpcClient.call).toHaveBeenLastCalledWith(
      RpcMethod.IngestionAck,
      expect.objectContaining({ jobId: expect.any(String) })
    )
  })
})
