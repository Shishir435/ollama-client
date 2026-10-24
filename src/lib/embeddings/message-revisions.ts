import { vectorDb } from "./db"
import type { VectorDocument } from "./types"

/** The same chunk in the same vector space is one idempotent write. */
export const messageChunkIdentity = (
  metadata: VectorDocument["metadata"]
): string =>
  JSON.stringify([
    metadata.sessionId,
    metadata.messageId,
    metadata.messageRevision,
    metadata.chunkIndex ?? 0,
    metadata.embeddingProviderId,
    metadata.embeddingModel,
    metadata.embeddingDim
  ])

/** Content hashes stay local and distinguish edits without retaining another message copy. */
export const messageRevision = async (message: {
  content: string
  role: string
  timestamp?: number
  sessionId?: string
}): Promise<string> => {
  const bytes = new TextEncoder().encode(
    JSON.stringify([
      message.sessionId,
      message.timestamp,
      message.role,
      message.content
    ])
  )
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    (byte) => byte.toString(16).padStart(2, "0")
  ).join("")
}

/** Fence before changing SQLite; late embedding responses fail inside their Dexie write. */
export const fenceMessageVectors = async (
  messageIds: number[],
  reason: "deleted" | "editing" | "cleared" = "deleted"
): Promise<Map<number, string>> => {
  const tokens = new Map(messageIds.map((id) => [id, crypto.randomUUID()]))
  await vectorDb.transaction(
    "rw",
    vectorDb.messageState,
    vectorDb.vectors,
    async () => {
      for (const [messageId, token] of tokens) {
        const current = await vectorDb.messageState.get(messageId)
        // Clearing derived memory must never weaken a canonical deletion fence.
        if (
          reason === "cleared" &&
          current?.deleted &&
          current.reason !== "cleared"
        )
          continue
        await vectorDb.messageState.put({
          messageId,
          token,
          revision: "",
          deleted: true,
          reason
        })
        await vectorDb.vectors
          .where("metadata.messageId")
          .equals(messageId)
          .delete()
      }
    }
  )
  return tokens
}

/** Fence the session before enumerating ids, covering concurrent new messages too. */
export const fenceSessionVectors = async (sessionId: string): Promise<void> => {
  await vectorDb.deletedSessions.put({ sessionId })
  const vectors = await vectorDb.vectors
    .where("metadata.sessionId")
    .equals(sessionId)
    .filter((doc) => doc.metadata.type === "chat")
    .toArray()
  await fenceMessageVectors(
    vectors.flatMap((doc) =>
      doc.metadata.messageId !== undefined ? [doc.metadata.messageId] : []
    )
  )
  await vectorDb.vectors
    .where("metadata.sessionId")
    .equals(sessionId)
    .filter((doc) => doc.metadata.type === "chat")
    .delete()
}

/** Explicitly creating/importing a session permits new indexing in that session. */
export const permitSessionVectors = async (
  sessionId: string
): Promise<void> => {
  await vectorDb.deletedSessions.delete(sessionId)
}

/** Only the mutation that installed a fence may reopen it for the new revision. */
export const activateMessageRevision = async (
  messageId: number,
  revision: string,
  token?: string
): Promise<boolean> =>
  vectorDb.transaction(
    "rw",
    vectorDb.messageState,
    vectorDb.vectors,
    async () => {
      const current = await vectorDb.messageState.get(messageId)
      if (
        current &&
        (token
          ? current.token !== token
          : current.deleted || current.revision !== revision)
      )
        return false
      if (!current || current.revision !== revision)
        await vectorDb.vectors
          .where("metadata.messageId")
          .equals(messageId)
          .delete()
      await vectorDb.messageState.put({
        messageId,
        token: current?.token ?? crypto.randomUUID(),
        revision,
        deleted: false
      })
      return true
    }
  )
