import type { ProcessedFile } from "@/lib/file-processors/types"
import { ingestionPayloadDb } from "@/lib/ingestion/ingestion-payload-db"
import { getActiveKnowledgeSetId } from "@/lib/knowledge/knowledge-sets"
import { extensionRpcClient } from "@/protocol/extension-client"
import type { IngestionJobResult } from "@/protocol/ingestion-rpc"
import { RpcMethod } from "@/protocol/rpc"

const createFileId = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? `file-${crypto.randomUUID()}`
    : `file-${Date.now()}-${Math.random().toString(16).slice(2)}`

const createJobId = (): string => crypto.randomUUID()

const waitForTerminalJob = async (
  initial: IngestionJobResult,
  onStatus?: (job: IngestionJobResult) => void
): Promise<IngestionJobResult> => {
  let job = initial
  while (job.status === "queued" || job.status === "running") {
    onStatus?.(job)
    await new Promise((resolve) => setTimeout(resolve, 150))
    job = await extensionRpcClient.call(RpcMethod.IngestionGet, {
      jobId: job.jobId
    })
  }
  onStatus?.(job)
  return job
}

export const IngestionClient = {
  async submitFile(
    file: File,
    options: {
      autoEmbed: boolean
      onStatus?: (job: IngestionJobResult) => void
    }
  ): Promise<ProcessedFile> {
    const jobId = createJobId()
    const fileId = createFileId()
    const knowledgeSetId = await getActiveKnowledgeSetId()
    const createdAt = Date.now()
    const bytes = await file.arrayBuffer()

    await ingestionPayloadDb.payloads.put({
      kind: "raw",
      jobId,
      fileId,
      knowledgeSetId,
      fileName: file.name,
      contentType: file.type || "text/plain",
      autoEmbed: options.autoEmbed,
      createdAt,
      bytes,
      lastModified: file.lastModified
    })

    const submitted = await extensionRpcClient.call(RpcMethod.IngestionSubmit, {
      jobId
    })
    const terminal = await waitForTerminalJob(submitted, options.onStatus)
    if (terminal.status !== "completed") {
      throw new Error(
        terminal.failure ||
          (terminal.status === "cancelled"
            ? "File ingestion was cancelled"
            : "File ingestion failed")
      )
    }
    if (!terminal.processedFile) {
      throw new Error("Completed ingestion result is unavailable")
    }
    return terminal.processedFile
  }
}
