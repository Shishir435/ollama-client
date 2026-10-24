import { useEffect, useState } from "react"
import { applyVectorStorageChanges } from "@/lib/embeddings/vector-storage-stats"
import { vectorDb } from "@/lib/embeddings/vector-store"
import { logger } from "@/lib/logger"
import {
  countMessages,
  getMessagesPaginated
} from "@/lib/repositories/chat-history"
import { requestMessageIndexing } from "@/protocol/embedding-client"

const BATCH_SIZE = 10

type MigrationMessage = Awaited<ReturnType<typeof getMessagesPaginated>>[number]

const messageIdOf = (message: MigrationMessage): number | undefined =>
  typeof message.id === "number" ? message.id : undefined

const shouldSkipMessage = (message: MigrationMessage): boolean =>
  !message.content ||
  !message.role ||
  !message.sessionId ||
  message.role === "system" ||
  (message.role === "assistant" && !message.done)

const hasLinkedVector = async (messageId?: number): Promise<boolean> => {
  if (!messageId) return false
  const existing = await vectorDb.vectors
    .where("metadata.messageId")
    .equals(messageId)
    .first()
  return Boolean(existing)
}

const removeLegacyVector = async (message: MigrationMessage): Promise<void> => {
  await vectorDb.transaction(
    "rw",
    vectorDb.vectors,
    vectorDb.vectorStats,
    async () => {
      const legacy = await vectorDb.vectors
        .where("metadata.sessionId")
        .equals(message.sessionId)
        .filter(
          (doc) => doc.content === message.content && !doc.metadata.messageId
        )
        .toArray()
      await vectorDb.vectors.bulkDelete(
        legacy.flatMap((vector) => (vector.id === undefined ? [] : [vector.id]))
      )
      await applyVectorStorageChanges(
        vectorDb.vectorStats,
        legacy.map((before) => ({ before }))
      )
    }
  )
}

/** The background prepares canonical revisions and owns every chunk write. */
const queueMessage = async (message: MigrationMessage): Promise<void> => {
  const id = messageIdOf(message)
  if (id !== undefined) await requestMessageIndexing([id])
}

const migrateMessage = async (message: MigrationMessage): Promise<void> => {
  try {
    await queueMessage(message)
    await removeLegacyVector(message)
  } catch (err) {
    logger.error("Failed to queue message indexing", "useEmbeddingMigration", {
      err,
      messageId: messageIdOf(message)
    })
  }
}

const migrationIsNeeded = async (totalMessages: number): Promise<boolean> => {
  if (totalMessages === 0) return false
  const vectorsWithMessageId = await vectorDb.vectors
    .where("metadata.messageId")
    .above(0)
    .count()
  return vectorsWithMessageId < totalMessages * 0.9
}

const runEmbeddingMigration = async (
  setProgress: (value: number) => void
): Promise<number> => {
  let processed = 0
  let offset = 0

  while (true) {
    const messages = await getMessagesPaginated(offset, BATCH_SIZE)
    if (messages.length === 0) return processed

    for (const message of messages) {
      if (shouldSkipMessage(message)) continue
      if (await hasLinkedVector(messageIdOf(message))) {
        processed += 1
        continue
      }

      await migrateMessage(message)
      processed += 1
      setProgress(processed)
      await new Promise((resolve) => setTimeout(resolve, 10))
    }

    offset += BATCH_SIZE
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}

export const useEmbeddingMigration = () => {
  const [isMigrating, setIsMigrating] = useState(false)
  const [progress, setProgress] = useState(0)
  const [total, setTotal] = useState(0)

  useEffect(() => {
    const runMigration = async () => {
      try {
        const totalMessages = await countMessages()
        if (!(await migrationIsNeeded(totalMessages))) return

        setIsMigrating(true)
        setTotal(totalMessages)
        await runEmbeddingMigration(setProgress)
        logger.info("Migration queued", "useEmbeddingMigration")
      } catch (error) {
        logger.error("Migration failed", "useEmbeddingMigration", { error })
      } finally {
        setIsMigrating(false)
      }
    }

    const timer = setTimeout(() => {
      void runMigration()
    }, 5000)

    return () => clearTimeout(timer)
  }, [])

  return { isMigrating, progress, total }
}
