import { useEffect, useState } from "react"

import { db } from "@/lib/db"
import { generateEmbedding } from "@/lib/embeddings/ollama-embedder"
import { storeVector, vectorDb } from "@/lib/embeddings/vector-store"
import { logger } from "@/lib/logger"
import type { Role } from "@/types"

export const useEmbeddingMigration = () => {
  const [isMigrating, setIsMigrating] = useState(false)
  const [progress, setProgress] = useState(0)
  const [total, setTotal] = useState(0)

  useEffect(() => {
    const runMigration = async () => {
      try {
        /*
         * 1. Check if migration is needed
         * Count messages that don't have embeddings or linked embeddings
         * This is a bit expensive to check perfectly, so we'll do a simplified check:
         * iterate sessions, check if their messages have corresponding vectors with messageId
         *
         * Better approach:
         * We know we just added messageId support.
         * We can check if there are any vectors with type='chat' but NO messageId.
         * If so, we probably want to migrate them OR just nuke them and re-embed.
         * Re-embedding is safer to ensure correct linkage.
         */

        // Let's count messages in DB
        const totalMessages = await db.messages.count()
        if (totalMessages === 0) return

        // Check if we have vectors with messageId
        const vectorsWithMessageId = await vectorDb.vectors
          .where("metadata.messageId")
          .above(0)
          .count()

        // If we have significantly fewer vectors with messageId than messages, we assume migration is needed
        // (This logic might rerun if user has many short messages that were skipped, but that's okay/safe)
        if (vectorsWithMessageId >= totalMessages * 0.9) return

        setIsMigrating(true)
        setTotal(totalMessages)

        // Process in batches
        const BATCH_SIZE = 10
        let processed = 0
        let offset = 0

        /*
         * We'll iterate all messages from newest to oldest (as they are more likely to be accessed)
         * But for reliable migration, maybe oldest to newest?
         * Let's do huge chunks.
         */

        while (true) {
          const messages = await db.messages
            .offset(offset)
            .limit(BATCH_SIZE)
            .toArray()

          if (messages.length === 0) break

          for (const message of messages) {
            // Skip invalid messages
            if (!message.content || !message.role || !message.sessionId)
              continue
            if (message.role === "system") continue
            if (message.role === "assistant" && !message.done) continue

            // Check if this message already has a vector with messageId
            if (message.id) {
              const existing = await vectorDb.vectors
                .where("metadata.messageId")
                .equals(message.id)
                .first()

              if (existing) {
                processed++
                continue
              }
            }

            /*
             * No embedding with messageId found.
             * We should remove any old embedding for this content to avoid dupes?
             * "Legacy" embeddings didn't have messageId.
             * We can delete by content matching if we want to be super clean,
             * but the `storeVector` deduplication might handle it if we passed the right metadata?
             * Actually `storeVector` checks for duplicates by content + sessionId + messageId (now).
             * So we might end up with dupes if we don't clean up old ones.
             * Let's try to find legacy embedding and delete it.
             */

            await vectorDb.vectors
              .where("metadata.sessionId")
              .equals(message.sessionId)
              .filter(
                (doc) =>
                  doc.content === message.content && !doc.metadata.messageId
              )
              .delete()

            // Generate new embedding
            try {
              const result = await generateEmbedding(message.content)
              if (!("error" in result)) {
                await storeVector(message.content, result.embedding, {
                  type: "chat",
                  source: "chat",
                  sessionId: message.sessionId,
                  timestamp: message.timestamp || Date.now(),
                  role: message.role as Role,
                  messageId: message.id,
                  title:
                    message.role === "user"
                      ? "User message"
                      : "Assistant response"
                })
              }
            } catch (err) {
              logger.error(
                "Failed to generate embedding",
                "useEmbeddingMigration",
                { err, message }
              )
            }

            processed++
            setProgress(processed)

            // Yield directly
            await new Promise((r) => setTimeout(r, 10))
          }

          offset += BATCH_SIZE

          // Yield to UI
          await new Promise((r) => setTimeout(r, 100))
        }

        setIsMigrating(false)
        logger.info("Migration complete", "useEmbeddingMigration")
      } catch (error) {
        logger.error("Migration failed", "useEmbeddingMigration", { error })
        setIsMigrating(false)
      }
    }

    // Delay start to let app load
    const timer = setTimeout(() => {
      runMigration()
    }, 5000)

    return () => clearTimeout(timer)
  }, [])

  return { isMigrating, progress, total }
}
