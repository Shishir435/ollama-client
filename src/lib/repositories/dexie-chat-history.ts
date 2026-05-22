import { db } from "@/lib/db"
import type { ChatMessage, ChatSession, FileAttachment } from "@/types"

/**
 * Dexie-backed persistence for chat history.
 *
 * This module is the single place in the codebase that touches the
 * `sessions`, `messages`, and `files` Dexie tables. Higher-level callers
 * (the chat-session store, the chat hook) consume it through this
 * narrow surface so the eventual Dexie -> SQLite migration touches one
 * module instead of every store.
 *
 * Operations are kept query-specific (e.g. `getMessagesByParents`)
 * rather than generic CRUD because the store performs tree-shaped reads
 * that don't map cleanly to a basic ChatRepository interface. The
 * existing `ChatRepository` / `SQLiteChatRepository` types are left
 * untouched here — those describe the long-term SQLite surface and
 * will absorb these operations as part of the Dexie retirement.
 */

type StoredMessage = ChatMessage & { sessionId: string; id?: number }
type StoredFile = FileAttachment & { sessionId: string; id?: number }

// ----- Sessions ------------------------------------------------------------

export const getAllSessionsOrderedByRecency = (): Promise<ChatSession[]> =>
  db.sessions.orderBy("updatedAt").reverse().toArray()

/**
 * All sessions, no ordering guarantee. Used by export/backfill flows
 * that want every row regardless of recency.
 */
export const getAllSessions = (): Promise<ChatSession[]> =>
  db.sessions.toArray()

export const getSession = (id: string): Promise<ChatSession | undefined> =>
  db.sessions.get(id)

export const getLatestSession = (): Promise<ChatSession | undefined> =>
  db.sessions.orderBy("createdAt").reverse().first()

export const addSession = (session: ChatSession): Promise<string> =>
  db.sessions.add(session) as unknown as Promise<string>

export const bulkPutSessions = (sessions: ChatSession[]): Promise<unknown> =>
  db.sessions.bulkPut(sessions)

export const updateSession = (
  id: string,
  updates: Partial<ChatSession>
): Promise<number> => db.sessions.update(id, updates)

export const deleteSessionRow = (id: string): Promise<void> =>
  db.sessions.delete(id)

// ----- Messages ------------------------------------------------------------

export const getMessage = (
  id: number | string
): Promise<StoredMessage | undefined> => db.messages.get(id)

/** Total message count across all sessions. */
export const countMessages = (): Promise<number> => db.messages.count()

/** Every message row, no ordering guarantee. Caller-allocated array. */
export const getAllMessages = (): Promise<StoredMessage[]> =>
  db.messages.toArray()

/**
 * Window of messages by absolute offset. Used by long-running
 * embedding-backfill / migration loops that paginate to keep memory
 * bounded.
 */
export const getMessagesPaginated = (
  offset: number,
  limit: number
): Promise<StoredMessage[]> => db.messages.offset(offset).limit(limit).toArray()

export const getMessagesBySessionOrderedByTimestamp = (
  sessionId: string
): Promise<StoredMessage[]> =>
  db.messages.where("sessionId").equals(sessionId).sortBy("timestamp")

export const getMessagesBySession = (
  sessionId: string
): Promise<StoredMessage[]> =>
  db.messages.where("sessionId").equals(sessionId).toArray()

export const getMessagesBySessionAtTimestamp = (
  sessionId: string,
  timestamp: number
): Promise<StoredMessage[]> =>
  db.messages
    .where("sessionId")
    .equals(sessionId)
    .filter((m) => m.timestamp === timestamp)
    .toArray()

export const getMessagesByParents = (
  parentIds: Array<number | string>
): Promise<StoredMessage[]> =>
  db.messages.where("parentId").anyOf(parentIds).toArray()

export const getRootMessagesForSession = (
  sessionId: string
): Promise<StoredMessage[]> =>
  db.messages
    .where("sessionId")
    .equals(sessionId)
    .filter((m) => !m.parentId)
    .toArray()

export const addMessage = async (
  message: Omit<StoredMessage, "id">
): Promise<number> => {
  const id = await db.messages.add(message as StoredMessage)
  return id as number
}

export const updateMessage = (
  id: number,
  updates: Partial<ChatMessage>
): Promise<number> => {
  const { id: _ignored, ...safeUpdates } = updates
  return db.messages.update(id, safeUpdates)
}

export const deleteMessagesBySession = (sessionId: string): Promise<number> =>
  db.messages.where("sessionId").equals(sessionId).delete()

export const bulkDeleteMessages = (ids: number[]): Promise<void> =>
  db.messages.bulkDelete(ids)

// ----- Files ---------------------------------------------------------------

export const getFilesByMessageIds = (
  messageIds: number[]
): Promise<StoredFile[]> =>
  db.files.where("messageId").anyOf(messageIds).toArray()

export const bulkAddFiles = (
  files: Array<FileAttachment & { sessionId: string; messageId?: number }>
): Promise<unknown> => db.files.bulkAdd(files)

export const deleteFilesBySession = (sessionId: string): Promise<number> =>
  db.files.where("sessionId").equals(sessionId).delete()

export const deleteFilesByMessageIds = (
  messageIds: number[]
): Promise<number> => db.files.where("messageId").anyOf(messageIds).delete()

// ----- Database-level operations ------------------------------------------

/**
 * Drop the entire Dexie database. Used by the user-facing "reset all
 * app data" flow. The next read will recreate the schema from scratch
 * via Dexie's version()/upgrade() chain.
 */
export const dropDatabase = (): Promise<void> => db.delete()
