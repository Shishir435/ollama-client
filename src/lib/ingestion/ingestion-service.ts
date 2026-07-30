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
import type {
  IngestionJobResult,
  IngestionSubmitRequest
} from "@/protocol/ingestion-rpc"
import { ingestionPayloadDb } from "./ingestion-payload-db"

interface ActiveIngestion {
  controller: AbortController
  promise: Promise<void>
}

const activeIngestions = new Map<string, ActiveIngestion>()
const activeFileJobs = new Map<string, string>()

const resultFromRun = (run: IngestionRun): IngestionJobResult => ({
  jobId: run.id,
  fileId: run.fileId,
  status: run.status,
  phase: run.phase,
  ...(run.failure && { failure: run.failure })
})

const checkpoint = async (
  run: IngestionRun,
  status: IngestionRun["status"],
  phase: IngestionPhase,
  failure?: string
): Promise<IngestionRun> => {
  const updated: IngestionRun = {
    ...run,
    status,
    phase,
    failure,
    updatedAt: Date.now()
  }
  await saveIngestionRun(updated)
  return updated
}

const compensate = async (run: IngestionRun): Promise<void> => {
  await deleteVectors({ fileId: run.fileId })
  await removeKnowledgeFile(run.fileId)
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
  signal: AbortSignal
): Promise<void> => {
  let run = initialRun
  try {
    if (run.phase === "compensating") {
      await compensate(run)
      await ingestionPayloadDb.payloads.delete(run.id)
      await checkpoint(
        run,
        run.failure ? "failed" : "cancelled",
        "completed",
        run.failure
      )
      return
    }

    const payload = await ingestionPayloadDb.payloads.get(run.id)
    if (!payload) {
      throw createAppError("The durable ingestion payload is missing", {
        kind: "storage"
      })
    }

    signal.throwIfAborted()
    run = await checkpoint(run, "running", "registering")
    const { processedFile, contentType } = payload
    await addFileToKnowledgeSet({
      id: run.fileId,
      knowledgeSetId: run.knowledgeSetId,
      fileName: processedFile.metadata.fileName,
      fileType: processedFile.metadata.fileType,
      fileSize: processedFile.metadata.fileSize,
      createdAt: processedFile.metadata.processedAt || Date.now()
    })

    if (run.autoEmbed) {
      signal.throwIfAborted()
      run = await checkpoint(run, "running", "embedding")

      // Recovery and retry always start from a clean vector side of the saga.
      await deleteVectors({ fileId: run.fileId })
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
    if (run.autoEmbed) {
      await markKnowledgeFileEmbedded(run.fileId)
    }
    run = await checkpoint(run, "completed", "completed")
    await ingestionPayloadDb.payloads.delete(run.id).catch((error) => {
      // The durable receipt is authoritative. A stale payload is safe and can
      // be pruned later; it must never roll back a committed ingestion.
      logger.warn(
        "Failed to prune completed ingestion payload",
        "IngestionService",
        {
          jobId: run.id,
          error
        }
      )
    })
  } catch (error) {
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

const start = (run: IngestionRun): Promise<void> => {
  const active = activeIngestions.get(run.id)
  if (active) return active.promise

  const controller = new AbortController()
  const activeJobId = activeFileJobs.get(run.fileId)
  if (activeJobId && activeJobId !== run.id) {
    const promise = cancelSiblingRun(run, activeJobId).finally(() => {
      activeIngestions.delete(run.id)
    })
    activeIngestions.set(run.id, { controller, promise })
    return promise
  }

  activeFileJobs.set(run.fileId, run.id)
  const promise = execute(run, controller.signal).finally(() => {
    activeIngestions.delete(run.id)
    if (activeFileJobs.get(run.fileId) === run.id) {
      activeFileJobs.delete(run.fileId)
    }
  })
  activeIngestions.set(run.id, { controller, promise })
  return promise
}

export const IngestionService = {
  async submit(request: IngestionSubmitRequest): Promise<IngestionJobResult> {
    const { processedFile } = request
    const fileId = processedFile.metadata.fileId
    const knowledgeSetId = processedFile.metadata.knowledgeSetId
    const now = Date.now()
    const run: IngestionRun = {
      id: crypto.randomUUID(),
      fileId,
      knowledgeSetId,
      fileName: processedFile.metadata.fileName,
      status: "queued",
      phase: "queued",
      autoEmbed: request.autoEmbed,
      createdAt: now,
      updatedAt: now
    }

    await ingestionPayloadDb.payloads.put({
      jobId: run.id,
      contentType: request.contentType,
      processedFile
    })
    try {
      await saveIngestionRun(run)
    } catch (error) {
      await ingestionPayloadDb.payloads.delete(run.id)
      throw error
    }
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
    return resultFromRun(run)
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

  async resumeIncomplete(): Promise<void> {
    const runs = await listIncompleteIngestionRuns()
    await Promise.all(runs.map((run) => start(run)))
  }
}
