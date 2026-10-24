import { z } from "zod"
import { flushSave, query, run } from "@/lib/sqlite/db"
import { decodeRows } from "./row-decoder"

const JobSchema = z.object({
  messageId: z.number().int().positive(),
  token: z.string().min(1)
})
export type MessageIndexJob = z.infer<typeof JobSchema>

export const listMessageIndexJobs = async (
  afterMessageId = 0
): Promise<MessageIndexJob[]> =>
  decodeRows(
    JobSchema,
    await query(
      "SELECT messageId, token FROM message_index_jobs WHERE messageId > ? ORDER BY messageId LIMIT 20",
      [afterMessageId]
    ),
    { table: "message_index_jobs", operation: "resume" }
  )

export const acknowledgeMessageIndexJob = async (
  job: MessageIndexJob
): Promise<void> => {
  await run(
    "DELETE FROM message_index_jobs WHERE messageId = ? AND token = ?",
    [job.messageId, job.token]
  )
}

/** A rebuild repairs legacy tail loss without storing another content copy. */
export const queueMessageIndexJobs = async (
  messageIds: number[],
  rebuild = false
): Promise<void> => {
  if (rebuild)
    await run(
      "INSERT OR REPLACE INTO message_index_jobs SELECT id, lower(hex(randomblob(16))) FROM messages WHERE role IN ('user', 'assistant') AND done = 1"
    )
  else
    for (const id of messageIds)
      await run(
        "INSERT OR REPLACE INTO message_index_jobs SELECT id, lower(hex(randomblob(16))) FROM messages WHERE id = ? AND role IN ('user', 'assistant') AND done = 1",
        [id]
      )
  await flushSave()
}
