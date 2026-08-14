import { z } from "zod"
import { logger } from "@/lib/logger"
import { query, run } from "@/lib/sqlite/db"
import { deleteVectors } from "./vector-store"

const VectorCleanupReceiptSchema = z.object({
  messageId: z.number().int().positive(),
  createdAt: z.number().int().nonnegative()
})

const readPendingReceipts = async (): Promise<number[]> => {
  const rows = await query(
    `SELECT messageId, createdAt FROM vector_cleanup_receipts
     ORDER BY createdAt, messageId`
  )
  return rows.flatMap((row) => {
    const parsed = VectorCleanupReceiptSchema.safeParse(row)
    if (parsed.success) return [parsed.data.messageId]
    logger.warn("Refused an unreadable vector cleanup receipt", "Embeddings")
    return []
  })
}

/**
 * Converge derived Dexie vectors with committed SQLite message deletions.
 * Both deletion and acknowledgement are idempotent, so a worker may restart
 * between them without losing cleanup intent or harming live messages.
 */
export const sweepVectorCleanupReceipts = async (
  signal?: AbortSignal
): Promise<number> => {
  const messageIds = await readPendingReceipts()
  let completed = 0
  for (const messageId of messageIds) {
    signal?.throwIfAborted()
    await deleteVectors({ messageId })
    signal?.throwIfAborted()
    await run("DELETE FROM vector_cleanup_receipts WHERE messageId = ?", [
      messageId
    ])
    completed += 1
  }
  return completed
}
