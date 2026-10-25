import type { IngestionJobResult } from "@ollama-client/contracts/ingestion-rpc"
import { RpcMethod } from "@ollama-client/contracts/rpc"
import { abortableDelay } from "@/lib/abortable-delay"
import type { ProcessedFile } from "@/lib/file-processors/types"
import { ingestionPayloadDb } from "@/lib/ingestion/ingestion-payload-db"
import { getActiveKnowledgeSetId } from "@/lib/knowledge/knowledge-sets"
import { extensionRpcClient } from "@/protocol/extension-client"

/** Background ingestion failure retained for actionable UI feedback. */
export class IngestionFailureError extends Error {}

const createFileId = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? `file-${crypto.randomUUID()}`
    : `file-${Date.now()}-${Math.random().toString(16).slice(2)}`

const createJobId = (): string => crypto.randomUUID()

/** A disconnected observer can resume with this id; the durable job keeps running. */
export class IngestionObservationError extends Error {
  /** Keep the job id available for reconnection after observation stops. */
  constructor(readonly jobId: string) {
    super("File ingestion is still running. Reconnect to check its result.")
  }
}

const waitForTerminalJob = async (
  initial: IngestionJobResult,
  onStatus?: (job: IngestionJobResult) => void,
  signal?: AbortSignal
): Promise<IngestionJobResult> => {
  let job = initial
  let delay = 250
  let failures = 0
  const deadline = Date.now() + 30 * 60_000
  onStatus?.(job)
  while (job.status === "queued" || job.status === "running") {
    signal?.throwIfAborted()
    if (Date.now() >= deadline) throw new IngestionObservationError(job.jobId)
    await abortableDelay(Math.min(delay, deadline - Date.now()), signal)
    let next: IngestionJobResult
    try {
      next = await extensionRpcClient.call(
        RpcMethod.IngestionGet,
        {
          jobId: job.jobId
        },
        { signal }
      )
    } catch {
      signal?.throwIfAborted()
      failures += 1
      if (failures >= 8) throw new IngestionObservationError(job.jobId)
      delay = Math.min(delay * 2, 5000)
      continue
    }
    failures = 0
    if (next.status !== job.status || next.phase !== job.phase) {
      delay = 250
      onStatus?.(next)
    } else delay = Math.min(delay * 1.5, 3000)
    job = next
  }
  return job
}

export const IngestionClient = {
  async observe(
    jobId: string,
    options: {
      signal?: AbortSignal
      onStatus?: (job: IngestionJobResult) => void
    } = {}
  ): Promise<IngestionJobResult> {
    const initial = await extensionRpcClient.call(
      RpcMethod.IngestionGet,
      { jobId },
      { signal: options.signal }
    )
    return waitForTerminalJob(initial, options.onStatus, options.signal)
  },
  async submitFile(
    file: File,
    options: {
      autoEmbed: boolean
      signal?: AbortSignal
      onStatus?: (job: IngestionJobResult) => void
    }
  ): Promise<ProcessedFile> {
    options.signal?.throwIfAborted()
    const jobId = createJobId()
    const fileId = createFileId()
    const knowledgeSetId = await getActiveKnowledgeSetId()
    const createdAt = Date.now()
    const bytes = await file.arrayBuffer()
    options.signal?.throwIfAborted()

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

    if (options.signal?.aborted) {
      // No submission has been sent, so removing this staging record cannot
      // erase work a background owner may already have claimed.
      await ingestionPayloadDb.payloads.delete(jobId)
      options.signal.throwIfAborted()
    }
    const submitted = await extensionRpcClient.call(RpcMethod.IngestionSubmit, {
      jobId
    })
    const terminal = await waitForTerminalJob(
      submitted,
      options.onStatus,
      options.signal
    )
    if (terminal.status !== "completed") {
      throw new IngestionFailureError(
        terminal.failure ||
          (terminal.status === "cancelled"
            ? "File ingestion was cancelled"
            : "File ingestion failed")
      )
    }
    if (!terminal.processedFile) {
      throw new Error("Completed ingestion result is unavailable")
    }
    // Release the staged copy only now that the result is in hand; a dropped
    // response leaves it recoverable on the next poll instead of lost.
    await extensionRpcClient
      .call(RpcMethod.IngestionAck, { jobId: terminal.jobId })
      .catch(() => undefined)
    return terminal.processedFile
  }
}
