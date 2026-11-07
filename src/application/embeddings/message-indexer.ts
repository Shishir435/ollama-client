import { EmbeddingService } from "@/application/embeddings/embedding-service"
import { chunkTextAsync } from "@/lib/embeddings/chunker"
import { getEmbeddingConfig } from "@/lib/embeddings/config"
import { assessContentQuality } from "@/lib/embeddings/content-quality-filter"
import { removeLegacyChatVectors, storeVector } from "@/lib/embeddings/storage"
import { logger } from "@/lib/logger"
import {
  getMessage,
  getMessageForIndexing
} from "@/lib/repositories/chat-history"
import {
  acknowledgeMessageIndexJob,
  listMessageIndexJobs,
  queueMessageIndexJobs
} from "@/lib/repositories/message-index-jobs"
import { readSetting } from "@/lib/storage/setting-access"
import { SETTINGS } from "@/lib/storage/settings"

let running: Promise<void> | undefined
let requested = false
let runningSignal: AbortSignal | undefined

/** Background-owned, durable id-only work survives closing the panel. */
export const resumeMessageIndexing = (signal?: AbortSignal): Promise<void> => {
  signal?.throwIfAborted()
  requested = true
  if (running) {
    const active = running
    const ownerSignal = runningSignal
    // An independent request resumes only after the supervised owner has stopped.
    if (!signal && ownerSignal)
      return active.catch((error) => {
        if (ownerSignal.aborted) return resumeMessageIndexing()
        throw error
      })
    if (signal && signal !== ownerSignal)
      return new Promise<void>((resolve, reject) => {
        const abort = () => {
          signal.removeEventListener("abort", abort)
          reject(signal.reason)
        }
        signal.addEventListener("abort", abort, { once: true })
        active.then(
          () => {
            signal.removeEventListener("abort", abort)
            resolve()
          },
          (error) => {
            signal.removeEventListener("abort", abort)
            reject(error)
          }
        )
      })
    return active
  }
  runningSignal = signal
  running = (async () => {
    do {
      requested = false
      await drive(signal)
    } while (requested && !signal?.aborted)
  })().finally(() => {
    running = undefined
    runningSignal = undefined
  })
  return running
}

const drive = async (signal?: AbortSignal): Promise<void> => {
  let afterMessageId = 0
  let failed = false
  for (;;) {
    signal?.throwIfAborted()
    if (!(await readSetting(SETTINGS.MEMORY_ENABLED))) return
    const jobs = await listMessageIndexJobs(afterMessageId)
    if (!jobs.length) {
      if (failed)
        throw new Error("Message indexing failed; pending jobs can be retried.")
      return
    }
    for (const job of jobs) {
      signal?.throwIfAborted()
      afterMessageId = job.messageId
      try {
        const prepared = await getMessageForIndexing(job.messageId, signal)
        signal?.throwIfAborted()
        if (!prepared) {
          await acknowledgeMessageIndexJob(job)
          continue
        }
        const { message, revision, token } = prepared
        const content = message.content.trim()
        const quality = assessContentQuality(content, message.role)
        if (!quality.shouldEmbed) {
          await acknowledgeMessageIndexJob(job)
          continue
        }
        const config = await getEmbeddingConfig()
        const chunks = await chunkTextAsync(content, {
          chunkSize: config.chunkSize,
          chunkOverlap: config.chunkOverlap,
          strategy: config.chunkingStrategy
        })
        for (let index = 0; index < chunks.length; index++) {
          signal?.throwIfAborted()
          if (!(await readSetting(SETTINGS.MEMORY_ENABLED))) return
          const result = await EmbeddingService.generate(
            chunks[index].text,
            undefined,
            undefined,
            signal ? { signal } : {}
          )
          signal?.throwIfAborted()
          if ("error" in result) {
            logger.warn("Message embedding failed", "MessageIndexer", {
              messageId: job.messageId,
              error: result.error,
              code: result.code
            })
            throw new Error(
              "Message indexing failed; the durable job can be retried.",
              { cause: result.error }
            )
          }
          if (!(await readSetting(SETTINGS.MEMORY_ENABLED))) return
          const id = await storeVector(chunks[index].text, result.embedding, {
            type: "chat",
            source: "chat",
            sessionId: message.sessionId,
            messageId: job.messageId,
            messageRevision: revision,
            messageIndexToken: token,
            timestamp: message.timestamp ?? Date.now(),
            role: message.role,
            title:
              message.role === "user" ? "User message" : "Assistant response",
            chunkIndex: index,
            totalChunks: chunks.length,
            qualityScore: quality.score,
            qualityReasons: quality.reasons.join(", "),
            embeddingModel: result.model,
            embeddingProviderId: result.providerId,
            embeddingDim: result.embedding.length
          })
          if (id === 0) break
        }
        await acknowledgeMessageIndexJob(job)
      } catch (error) {
        signal?.throwIfAborted()
        failed = true
        logger.warn("Message indexing job failed", "MessageIndexer", {
          messageId: job.messageId,
          error
        })
      }
    }
  }
}

export const enqueueMessageIndexing = async (
  messageIds: number[],
  options: { rebuild?: boolean; removeLegacyVectors?: boolean } = {}
): Promise<void> => {
  await queueMessageIndexJobs(messageIds, options.rebuild ?? false)
  try {
    if (options.removeLegacyVectors) {
      for (const messageId of messageIds) {
        const message = await getMessage(messageId)
        if (
          !message?.sessionId ||
          !message.done ||
          (message.role !== "user" && message.role !== "assistant")
        )
          continue
        await removeLegacyChatVectors(message.sessionId, message.content)
      }
    }
  } finally {
    void resumeMessageIndexing().catch((error) =>
      logger.warn(
        "Message indexing will resume on the next attempt",
        "MessageIndexer",
        { error }
      )
    )
  }
}
