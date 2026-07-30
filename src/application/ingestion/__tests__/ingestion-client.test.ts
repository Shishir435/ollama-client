import { beforeEach, describe, expect, it, vi } from "vitest"
import { ingestionPayloadDb } from "@/lib/ingestion/ingestion-payload-db"
import { extensionRpcClient } from "@/protocol/extension-client"
import { RpcMethod } from "@/protocol/rpc"

vi.mock("@/lib/knowledge/knowledge-sets", () => ({
  getActiveKnowledgeSetId: vi.fn().mockResolvedValue("knowledge-default")
}))

vi.mock("@/protocol/extension-client", () => ({
  extensionRpcClient: {
    call: vi.fn()
  }
}))

import { IngestionClient } from "../ingestion-client"

describe("IngestionClient", () => {
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
