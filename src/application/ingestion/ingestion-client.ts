import { processFile } from "@/lib/file-processors"
import type { ProcessedFile } from "@/lib/file-processors/types"
import { getActiveKnowledgeSetId } from "@/lib/knowledge/knowledge-sets"
import { extensionRpcClient } from "@/protocol/extension-client"
import type { IngestionJobResult } from "@/protocol/ingestion-rpc"
import { RpcMethod } from "@/protocol/rpc"

const createFileId = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? `file-${crypto.randomUUID()}`
    : `file-${Date.now()}-${Math.random().toString(16).slice(2)}`

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
      onStatus?: (job: IngestionJobResult, result: ProcessedFile) => void
    }
  ): Promise<ProcessedFile> {
    const processedFile = await processFile(file)
    processedFile.metadata.fileId ||= createFileId()
    processedFile.metadata.knowledgeSetId = await getActiveKnowledgeSetId()

    const submitted = await extensionRpcClient.call(RpcMethod.IngestionSubmit, {
      processedFile: {
        ...processedFile,
        metadata: {
          ...processedFile.metadata,
          fileId: processedFile.metadata.fileId,
          knowledgeSetId: processedFile.metadata.knowledgeSetId
        }
      },
      contentType: file.type || "text/plain",
      autoEmbed: options.autoEmbed
    })
    const terminal = await waitForTerminalJob(submitted, (job) =>
      options.onStatus?.(job, processedFile)
    )
    if (terminal.status !== "completed") {
      throw new Error(
        terminal.failure ||
          (terminal.status === "cancelled"
            ? "File ingestion was cancelled"
            : "File ingestion failed")
      )
    }
    return processedFile
  }
}
