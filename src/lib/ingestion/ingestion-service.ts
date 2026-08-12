import type {
  IngestionAckResult,
  IngestionJobResult,
  IngestionSubmitRequest
} from "@ollama-client/contracts/ingestion-rpc"
import { writeCheckpoint } from "@ollama-client/runtime-core/checkpoint"
import { deleteVectors } from "@/lib/embeddings/vector-store"
import { createAppError, getErrorMessage } from "@/lib/error-utils"
import { processKnowledge } from "@/lib/knowledge/knowledge-processor"
import {
  addFileToKnowledgeSet,
  markKnowledgeFileEmbedded,
  removeKnowledgeFile
} from "@/lib/knowledge/knowledge-sets"
import { logger } from "@/lib/logger"
import {
  getIngestionRun,
  type IngestionPhase,
  type IngestionRun,
  listIncompleteIngestionRuns,
  saveIngestionRun
} from "@/lib/repositories/ingestion-runs"
import type { IngestionPayload } from "./ingestion-payload-db"
import { ingestionPayloadDb } from "./ingestion-payload-db"
import { processStagedIngestion } from "./ingestion-processor-protocol"

interface ActiveIngestion {
  controller: AbortController
  promise: Promise<void>
}

const activeIngestions = new Map<string, ActiveIngestion>()
const activeFileJobs = new Map<string, string>()

const forwardAbort = (
  signal: AbortSignal | undefined,
  controller: AbortController
): (() => void) => {
  if (!signal) return () => undefined
  const abort = () => controller.abort(signal.reason)
  if (signal.aborted) abort()
  else signal.addEventListener("abort", abort, { once: true })
  return () => signal.removeEventListener("abort", abort)
}

const runFromPayload = (payload: IngestionPayload): IngestionRun => ({
  id: payload.jobId,
  fileId: payload.fileId,
  knowledgeSetId: payload.knowledgeSetId,
  fileName: payload.fileName,
  status: "queued",
  phase: "queued",
  autoEmbed: payload.autoEmbed,
  createdAt: payload.createdAt,
  updatedAt: payload.createdAt
})

const resultFromRun = (run: IngestionRun): IngestionJobResult => ({
  jobId: run.id,
  fileId: run.fileId,
  status: run.status,
  phase: run.phase,
  ...(run.failure && { failure: run.failure })
})

/**
 * A processed payload that was never acknowledged (the page closed before the
 * result was consumed) is pruned on the next background boot.
 */
const UNACKED_PAYLOAD_RETENTION_MS = 24 * 60 * 60 * 1000

const isTerminal = (run: IngestionRun): boolean =>
  run.status === "completed" ||
  run.status === "failed" ||
  run.status === "cancelled"

/** Completed runs carry the parse result until the caller acknowledges it. */
const resultWithPayload = async (
  run: IngestionRun
): Promise<IngestionJobResult> => {
  const result = resultFromRun(run)
  if (run.status !== "completed") return result
  const payload = await ingestionPayloadDb.payloads.get(run.id)
  if (payload?.kind !== "processed") return result
  return { ...result, processedFile: payload.processedFile }
}

const checkpoint = async (
  run: IngestionRun,
  status: IngestionRun["status"],
  phase: IngestionPhase,
  failure?: string
): Promise<IngestionRun> => {
  return writeCheckpoint(run, { status, phase, failure }, saveIngestionRun)
}

const compensate = async (
  run: IngestionRun,
  signal?: AbortSignal
): Promise<void> => {
  signal?.throwIfAborted()
  await deleteVectors({ fileId: run.fileId })
  signal?.throwIfAborted()
  await removeKnowledgeFile(run.fileId)
  signal?.throwIfAborted()
}

const cancelSiblingRun = async (
  run: IngestionRun,
  activeJobId: string
): Promise<void> => {
  logger.warn(
    "Cancelled overlapping ingestion for the same file",
    "IngestionService",
    {
      jobId: run.id,
      activeJobId,
      fileId: run.fileId
    }
  )
  await checkpoint(run, "cancelled", "completed")
  await ingestionPayloadDb.payloads.delete(run.id).catch((error) => {
    logger.warn(
      "Failed to prune cancelled ingestion payload",
      "IngestionService",
      {
        jobId: run.id,
        error
      }
    )
  })
}

const execute = async (
  initialRun: IngestionRun,
  signal: AbortSignal,
  recoverySignal?: AbortSignal
): Promise<void> => {
  let run = initialRun
  try {
    if (run.phase === "compensating") {
      await compensate(run, recoverySignal)
      recoverySignal?.throwIfAborted()
      await ingestionPayloadDb.payloads.delete(run.id)
      recoverySignal?.throwIfAborted()
      await checkpoint(
        run,
        run.failure ? "failed" : "cancelled",
        "completed",
        run.failure
      )
      return
    }

    let payload = await ingestionPayloadDb.payloads.get(run.id)
    if (!payload) {
      throw createAppError("The durable ingestion payload is missing", {
        kind: "storage"
      })
    }

    signal.throwIfAborted()
    if (payload.kind === "raw") {
      run = await checkpoint(run, "running", "parsing")
      recoverySignal?.throwIfAborted()
      await processStagedIngestion(run.id)
      recoverySignal?.throwIfAborted()
      payload = await ingestionPayloadDb.payloads.get(run.id)
      if (payload?.kind !== "processed") {
        throw createAppError("File parsing did not produce a durable result", {
          kind: "storage"
        })
      }
      signal.throwIfAborted()
    }

    run = await checkpoint(run, "running", "registering")
    recoverySignal?.throwIfAborted()
    const { processedFile, contentType } = payload
    await addFileToKnowledgeSet({
      id: run.fileId,
      knowledgeSetId: run.knowledgeSetId,
      fileName: processedFile.metadata.fileName,
      fileType: processedFile.metadata.fileType,
      fileSize: processedFile.metadata.fileSize,
      createdAt: processedFile.metadata.processedAt || Date.now()
    })
    recoverySignal?.throwIfAborted()

    if (run.autoEmbed) {
      signal.throwIfAborted()
      run = await checkpoint(run, "running", "embedding")

      // Recovery and retry always start from a clean vector side of the saga.
      await deleteVectors({ fileId: run.fileId })
      recoverySignal?.throwIfAborted()
      const embedded = await processKnowledge({
        fileId: run.fileId,
        fileName: processedFile.metadata.fileName,
        content: processedFile.text,
        pages: processedFile.pages,
        contentType,
        signal
      })
      if (!embedded.success) {
        throw createAppError(
          embedded.error || "Failed to embed processed file",
          { kind: "provider" }
        )
      }
    }

    signal.throwIfAborted()
    run = await checkpoint(run, "running", "committing")
    recoverySignal?.throwIfAborted()
    if (run.autoEmbed) {
      await markKnowledgeFileEmbedded(run.fileId)
    }
    await checkpoint(run, "completed", "completed")
  } catch (error) {
    // A startup deadline interrupts recovery; it does not cancel the user's
    // durable job. Leave the last checkpoint resumable for the next worker.
    if (recoverySignal?.aborted) return
    const cancelled = signal.aborted
    const failure = cancelled ? undefined : getErrorMessage(error)
    try {
      run = await checkpoint(run, "running", "compensating", failure)
      await compensate(run)
      await ingestionPayloadDb.payloads.delete(run.id)
      await checkpoint(
        run,
        cancelled ? "cancelled" : "failed",
        "completed",
        failure
      )
    } catch (compensationError) {
      logger.error("Ingestion compensation failed", "IngestionService", {
        jobId: run.id,
        error: compensationError
      })
      // Keep this non-terminal so the next worker boot retries compensation.
      await checkpoint(run, "running", "compensating", failure)
    }
  }
}

const start = (
  run: IngestionRun,
  recoverySignal?: AbortSignal
): Promise<void> => {
  const active = activeIngestions.get(run.id)
  // An existing execution was created by submit/retry and owns its controller.
  // Recovery may join that work, but its deadline must not gain cancellation
  // authority over a user-owned attempt or turn timeout into terminal intent.
  if (active) return active.promise

  const controller = new AbortController()
  const stopForwarding = forwardAbort(recoverySignal, controller)
  const activeJobId = activeFileJobs.get(run.fileId)
  if (activeJobId && activeJobId !== run.id) {
    const promise = cancelSiblingRun(run, activeJobId).finally(() => {
      stopForwarding()
      activeIngestions.delete(run.id)
    })
    activeIngestions.set(run.id, { controller, promise })
    return promise
  }

  activeFileJobs.set(run.fileId, run.id)
  const promise = execute(run, controller.signal, recoverySignal).finally(
    () => {
      stopForwarding()
      activeIngestions.delete(run.id)
      if (activeFileJobs.get(run.fileId) === run.id) {
        activeFileJobs.delete(run.fileId)
      }
    }
  )
  activeIngestions.set(run.id, { controller, promise })
  return promise
}

export const IngestionService = {
  async submit(request: IngestionSubmitRequest): Promise<IngestionJobResult> {
    const existing = await getIngestionRun(request.jobId)
    if (existing) {
      if (existing.status === "queued" || existing.status === "running") {
        void start(existing)
      }
      return resultWithPayload(existing)
    }

    const payload = await ingestionPayloadDb.payloads.get(request.jobId)
    if (!payload) {
      throw createAppError("The staged ingestion payload is missing", {
        kind: "storage"
      })
    }
    const run = runFromPayload(payload)
    await saveIngestionRun(run)
    void start(run).catch((error) => {
      logger.error("Durable ingestion execution failed", "IngestionService", {
        jobId: run.id,
        error
      })
    })
    return resultFromRun(run)
  },

  async get(jobId: string): Promise<IngestionJobResult> {
    const run = await getIngestionRun(jobId)
    if (!run) {
      throw createAppError("Ingestion job not found", {
        kind: "validation",
        status: 404
      })
    }
    return resultWithPayload(run)
  },

  /** Releases the staged result once the caller confirms it received it. */
  async acknowledge(jobId: string): Promise<IngestionAckResult> {
    const run = await getIngestionRun(jobId)
    if (!run) {
      throw createAppError("Ingestion job not found", {
        kind: "validation",
        status: 404
      })
    }
    if (!isTerminal(run)) return { jobId, released: false }
    await ingestionPayloadDb.payloads.delete(jobId)
    return { jobId, released: true }
  },

  async cancel(jobId: string): Promise<IngestionJobResult> {
    const active = activeIngestions.get(jobId)
    active?.controller.abort()
    await active?.promise

    const run = await getIngestionRun(jobId)
    if (!run) {
      throw createAppError("Ingestion job not found", {
        kind: "validation",
        status: 404
      })
    }
    if (run.status === "queued" || run.status === "running") {
      await compensate(run)
      await ingestionPayloadDb.payloads.delete(run.id)
      const cancelled = await checkpoint(run, "cancelled", "completed")
      return resultFromRun(cancelled)
    }
    return resultFromRun(run)
  },

  async resumeIncomplete(signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted()
    const now = Date.now()
    const payloads = await ingestionPayloadDb.payloads.toArray()
    for (const payload of payloads) {
      signal?.throwIfAborted()
      const existing = await getIngestionRun(payload.jobId)
      signal?.throwIfAborted()
      if (!existing) {
        await saveIngestionRun(runFromPayload(payload))
        continue
      }
      if (
        isTerminal(existing) &&
        now - existing.updatedAt > UNACKED_PAYLOAD_RETENTION_MS
      ) {
        await ingestionPayloadDb.payloads.delete(payload.jobId)
      }
    }
    signal?.throwIfAborted()
    const runs = await listIncompleteIngestionRuns()
    signal?.throwIfAborted()
    await Promise.all(runs.map((run) => start(run, signal)))
    signal?.throwIfAborted()
  }
}
