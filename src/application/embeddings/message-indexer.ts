import { EmbeddingService } from "@/application/embeddings/embedding-service"
import { chunkTextAsync } from "@/lib/embeddings/chunker"
import { getEmbeddingConfig } from "@/lib/embeddings/config"
import { assessContentQuality } from "@/lib/embeddings/content-quality-filter"
import { storeVector } from "@/lib/embeddings/storage"
import { logger } from "@/lib/logger"
import { getMessageForIndexing } from "@/lib/repositories/chat-history"
import {
  acknowledgeMessageIndexJob,
  listMessageIndexJobs,
  queueMessageIndexJobs
} from "@/lib/repositories/message-index-jobs"
import { readSetting } from "@/lib/storage/setting-access"
import { SETTINGS } from "@/lib/storage/settings"

let running: Promise<void> | undefined
let requested = false

/** Background-owned, durable id-only work survives closing the panel. */
export const resumeMessageIndexing = (signal?: AbortSignal): Promise<void> => {
  requested = true
  if (running) return running
  running = (async () => {
    do {
      requested = false
      await drive(signal)
    } while (requested && !signal?.aborted)
  })().finally(() => {
    running = undefined
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
        const prepared = await getMessageForIndexing(job.messageId)
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
          if ("error" in result)
            throw new Error(
              "Message indexing failed; the durable job can be retried."
            )
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
      } catch {
        signal?.throwIfAborted()
        failed = true
      }
    }
  }
}

export const enqueueMessageIndexing = async (
  messageIds: number[],
  rebuild = false
): Promise<void> => {
  await queueMessageIndexJobs(messageIds, rebuild)
  void resumeMessageIndexing().catch((error) =>
    logger.warn(
      "Message indexing will resume on the next attempt",
      "MessageIndexer",
      { error }
    )
  )
}
