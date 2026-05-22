import { query, resetSQLiteDatabase, run } from "@/lib/sqlite/db"
import type { ChatMessage, ChatSession, FileAttachment, Role } from "@/types"

/**
 * SQLite-backed implementation of the chat-history persistence surface
 * exposed by `dexie-chat-history.ts`. Same function names, same
 * argument shapes, same return shapes — the facade in
 * `chat-history.ts` picks one or the other at runtime.
 *
 * The migration-time class `SQLiteChatRepository` is kept separately
 * because it has migration-specific helpers (addMessageIfNotExists,
 * addFileIfNotExists) that callers should not see at runtime. This
 * module is the *runtime* surface.
 */

type StoredMessage = ChatMessage & { sessionId: string; id?: number }
type StoredFile = FileAttachment & { sessionId: string; id?: number }

type RowValue = string | number | null | Uint8Array
type Row = Record<string, RowValue>

const sessionFromRow = (row: Row): ChatSession => ({
  id: row.id as string,
  title: (row.title as string) ?? "",
  modelId: (row.modelId as string | null) ?? undefined,
  currentLeafId: (row.currentLeafId as number | null) ?? undefined,
  createdAt: row.createdAt as number,
  updatedAt: row.updatedAt as number,
  messages: []
})

const parseMetrics = (raw: RowValue): ChatMessage["metrics"] => {
  if (typeof raw !== "string" || raw.length === 0) return undefined
  try {
    return JSON.parse(raw) as ChatMessage["metrics"]
  } catch {
    return undefined
  }
}

const messageFromRow = (row: Row): StoredMessage => ({
  id: row.id as number,
  sessionId: row.sessionId as string,
  role: row.role as Role,
  content: row.content as string,
  model: (row.model as string | null) ?? undefined,
  timestamp: row.timestamp as number,
  parentId: (row.parentId as number | null) ?? undefined,
  done: ((row.done as number | null) ?? 1) !== 0,
  metrics: parseMetrics(row.metrics),
  thinking: (row.thinking as string | null) ?? undefined
})

const fileFromRow = (row: Row): StoredFile => ({
  id: row.id as number,
  fileId: row.fileId as string,
  sessionId: row.sessionId as string,
  messageId: (row.messageId as number | null) ?? undefined,
  fileType: row.fileType as string,
  fileName: (row.fileName as string | null) ?? "",
  fileSize: (row.fileSize as number | null) ?? 0,
  processedAt: (row.processedAt as number | null) ?? 0,
  data: (row.data as Uint8Array | null) ?? undefined
})

// Build a `?, ?, ?` placeholder list for an IN clause.
const placeholders = (n: number) => Array(n).fill("?").join(", ")

// ----- Sessions ------------------------------------------------------------

export const getAllSessionsOrderedByRecency = async (): Promise<
  ChatSession[]
> => {
  const rows = await query("SELECT * FROM sessions ORDER BY updatedAt DESC")
  return rows.map(sessionFromRow)
}

export const getAllSessions = async (): Promise<ChatSession[]> => {
  const rows = await query("SELECT * FROM sessions")
  return rows.map(sessionFromRow)
}

export const getSession = async (
  id: string
): Promise<ChatSession | undefined> => {
  const rows = await query("SELECT * FROM sessions WHERE id = ?", [id])
  return rows[0] ? sessionFromRow(rows[0]) : undefined
}

export const getLatestSession = async (): Promise<ChatSession | undefined> => {
  const rows = await query(
    "SELECT * FROM sessions ORDER BY createdAt DESC LIMIT 1"
  )
  return rows[0] ? sessionFromRow(rows[0]) : undefined
}

export const addSession = async (session: ChatSession): Promise<string> => {
  await run(
    `INSERT INTO sessions (id, title, modelId, currentLeafId, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      session.id,
      session.title ?? null,
      session.modelId ?? null,
      typeof session.currentLeafId === "number" ? session.currentLeafId : null,
      session.createdAt,
      session.updatedAt
    ]
  )
  return session.id
}

export const bulkPutSessions = async (
  sessions: ChatSession[]
): Promise<void> => {
  for (const session of sessions) {
    await run(
      `INSERT OR REPLACE INTO sessions (id, title, modelId, currentLeafId, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        session.id,
        session.title ?? null,
        session.modelId ?? null,
        typeof session.currentLeafId === "number"
          ? session.currentLeafId
          : null,
        session.createdAt,
        session.updatedAt
      ]
    )
  }
}

export const updateSession = async (
  id: string,
  updates: Partial<ChatSession>
): Promise<number> => {
  const fields: string[] = []
  const values: RowValue[] = []

  if (Object.hasOwn(updates, "title")) {
    fields.push("title = ?")
    values.push(updates.title ?? null)
  }
  if (Object.hasOwn(updates, "modelId")) {
    fields.push("modelId = ?")
    values.push(updates.modelId ?? null)
  }
  if (Object.hasOwn(updates, "currentLeafId")) {
    fields.push("currentLeafId = ?")
    values.push(
      typeof updates.currentLeafId === "number" ? updates.currentLeafId : null
    )
  }
  if (Object.hasOwn(updates, "updatedAt")) {
    fields.push("updatedAt = ?")
    values.push(updates.updatedAt ?? Date.now())
  }
  if (Object.hasOwn(updates, "createdAt")) {
    fields.push("createdAt = ?")
    values.push(updates.createdAt ?? Date.now())
  }

  if (fields.length === 0) return 0

  values.push(id)
  await run(`UPDATE sessions SET ${fields.join(", ")} WHERE id = ?`, values)
  return 1
}

export const deleteSessionRow = async (id: string): Promise<void> => {
  await run("DELETE FROM sessions WHERE id = ?", [id])
}

// ----- Messages ------------------------------------------------------------

export const getMessage = async (
  id: number | string
): Promise<StoredMessage | undefined> => {
  const rows = await query("SELECT * FROM messages WHERE id = ?", [Number(id)])
  return rows[0] ? messageFromRow(rows[0]) : undefined
}

export const countMessages = async (): Promise<number> => {
  const rows = await query("SELECT COUNT(*) AS count FROM messages")
  return (rows[0]?.count as number) ?? 0
}

export const getAllMessages = async (): Promise<StoredMessage[]> => {
  const rows = await query("SELECT * FROM messages")
  return rows.map(messageFromRow)
}

export const getMessagesPaginated = async (
  offset: number,
  limit: number
): Promise<StoredMessage[]> => {
  const rows = await query(
    "SELECT * FROM messages ORDER BY id LIMIT ? OFFSET ?",
    [limit, offset]
  )
  return rows.map(messageFromRow)
}

export const getMessagesBySessionOrderedByTimestamp = async (
  sessionId: string
): Promise<StoredMessage[]> => {
  const rows = await query(
    "SELECT * FROM messages WHERE sessionId = ? ORDER BY timestamp ASC",
    [sessionId]
  )
  return rows.map(messageFromRow)
}

export const getMessagesBySession = async (
  sessionId: string
): Promise<StoredMessage[]> => {
  const rows = await query("SELECT * FROM messages WHERE sessionId = ?", [
    sessionId
  ])
  return rows.map(messageFromRow)
}

export const getMessagesBySessionAtTimestamp = async (
  sessionId: string,
  timestamp: number
): Promise<StoredMessage[]> => {
  const rows = await query(
    "SELECT * FROM messages WHERE sessionId = ? AND timestamp = ?",
    [sessionId, timestamp]
  )
  return rows.map(messageFromRow)
}

export const getMessagesByParents = async (
  parentIds: Array<number | string>
): Promise<StoredMessage[]> => {
  if (parentIds.length === 0) return []
  const numericIds = parentIds.map((id) => Number(id))
  const rows = await query(
    `SELECT * FROM messages WHERE parentId IN (${placeholders(numericIds.length)})`,
    numericIds
  )
  return rows.map(messageFromRow)
}

export const getRootMessagesForSession = async (
  sessionId: string
): Promise<StoredMessage[]> => {
  const rows = await query(
    "SELECT * FROM messages WHERE sessionId = ? AND parentId IS NULL",
    [sessionId]
  )
  return rows.map(messageFromRow)
}

export const addMessage = async (
  message: Omit<StoredMessage, "id">
): Promise<number> => {
  await run(
    `INSERT INTO messages
     (sessionId, role, content, model, timestamp, parentId, done, metrics, thinking)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      message.sessionId,
      message.role,
      message.content,
      message.model ?? null,
      message.timestamp ?? Date.now(),
      typeof message.parentId === "number" ? message.parentId : null,
      message.done === false ? 0 : 1,
      message.metrics ? JSON.stringify(message.metrics) : null,
      message.thinking ?? null
    ]
  )
  const rows = await query("SELECT last_insert_rowid() AS id")
  return rows[0].id as number
}

export const updateMessage = async (
  id: number,
  updates: Partial<ChatMessage>
): Promise<number> => {
  const fields: string[] = []
  const values: RowValue[] = []

  if (Object.hasOwn(updates, "content")) {
    fields.push("content = ?")
    values.push(updates.content ?? "")
  }
  if (Object.hasOwn(updates, "thinking")) {
    fields.push("thinking = ?")
    values.push(updates.thinking ?? null)
  }
  if (Object.hasOwn(updates, "done")) {
    fields.push("done = ?")
    values.push(updates.done ? 1 : 0)
  }
  if (Object.hasOwn(updates, "metrics")) {
    fields.push("metrics = ?")
    values.push(updates.metrics ? JSON.stringify(updates.metrics) : null)
  }
  if (Object.hasOwn(updates, "model")) {
    fields.push("model = ?")
    values.push(updates.model ?? null)
  }
  if (Object.hasOwn(updates, "role")) {
    fields.push("role = ?")
    values.push(updates.role as string)
  }
  if (Object.hasOwn(updates, "timestamp")) {
    fields.push("timestamp = ?")
    values.push(updates.timestamp ?? Date.now())
  }
  if (Object.hasOwn(updates, "parentId")) {
    fields.push("parentId = ?")
    values.push(typeof updates.parentId === "number" ? updates.parentId : null)
  }

  if (fields.length === 0) return 0

  values.push(id)
  await run(`UPDATE messages SET ${fields.join(", ")} WHERE id = ?`, values)
  return 1
}

export const deleteMessagesBySession = async (
  sessionId: string
): Promise<number> => {
  const before = await query(
    "SELECT COUNT(*) AS count FROM messages WHERE sessionId = ?",
    [sessionId]
  )
  await run("DELETE FROM messages WHERE sessionId = ?", [sessionId])
  return (before[0]?.count as number) ?? 0
}

export const bulkDeleteMessages = async (ids: number[]): Promise<void> => {
  if (ids.length === 0) return
  await run(
    `DELETE FROM messages WHERE id IN (${placeholders(ids.length)})`,
    ids
  )
}

// ----- Files ---------------------------------------------------------------

export const getFilesByMessageIds = async (
  messageIds: number[]
): Promise<StoredFile[]> => {
  if (messageIds.length === 0) return []
  const rows = await query(
    `SELECT * FROM files WHERE messageId IN (${placeholders(messageIds.length)})`,
    messageIds
  )
  return rows.map(fileFromRow)
}

export const bulkAddFiles = async (
  files: Array<FileAttachment & { sessionId: string; messageId?: number }>
): Promise<void> => {
  for (const file of files) {
    const blob = file.data instanceof Uint8Array ? file.data : null
    await run(
      `INSERT INTO files (fileId, sessionId, messageId, fileType, fileName, fileSize, processedAt, data)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        file.fileId,
        file.sessionId,
        typeof file.messageId === "number" ? file.messageId : null,
        file.fileType,
        file.fileName ?? null,
        file.fileSize ?? 0,
        file.processedAt ?? Date.now(),
        blob
      ]
    )
  }
}

export const deleteFilesBySession = async (
  sessionId: string
): Promise<number> => {
  const before = await query(
    "SELECT COUNT(*) AS count FROM files WHERE sessionId = ?",
    [sessionId]
  )
  await run("DELETE FROM files WHERE sessionId = ?", [sessionId])
  return (before[0]?.count as number) ?? 0
}

export const deleteFilesByMessageIds = async (
  messageIds: number[]
): Promise<number> => {
  if (messageIds.length === 0) return 0
  const before = await query(
    `SELECT COUNT(*) AS count FROM files WHERE messageId IN (${placeholders(messageIds.length)})`,
    messageIds
  )
  await run(
    `DELETE FROM files WHERE messageId IN (${placeholders(messageIds.length)})`,
    messageIds
  )
  return (before[0]?.count as number) ?? 0
}

// ----- Health cookie -------------------------------------------------------

/**
 * Key stored in `kv_store` once SQLite is the confirmed source of
 * truth -- i.e. a Dexie -> SQLite migration completed AND flushed
 * to IndexedDB. The presence of this row is the signal the facade
 * uses to skip the "Dexie outpaces SQLite -> fall back" heuristic.
 *
 * Without this cookie, the auto-fallback would false-positive for
 * users who legitimately deleted sessions after migrating: Dexie's
 * stale pre-migration snapshot would still hold the deleted rows,
 * making Dexie strictly greater than SQLite and resurrecting the
 * deleted sessions in the UI on next reload.
 */
const SQLITE_HEALTHY_KEY = "chat-history-sqlite-healthy-v1"

export const isSqliteHealthy = async (): Promise<boolean> => {
  try {
    const rows = await query("SELECT value FROM kv_store WHERE key = ?", [
      SQLITE_HEALTHY_KEY
    ])
    return rows.length > 0
  } catch {
    // Table might not exist yet on a fresh init. Treat as not-healthy
    // and let the migration write the cookie when it finishes.
    return false
  }
}

export const markSqliteHealthy = async (): Promise<void> => {
  await run("INSERT OR REPLACE INTO kv_store (key, value) VALUES (?, ?)", [
    SQLITE_HEALTHY_KEY,
    "1"
  ])
}

// ----- Database-level operations ------------------------------------------

/**
 * Drop the SQLite-backed chat database. Used by the user-facing
 * "reset all app data" flow. The next read will recreate the schema
 * via `initSQLite()`'s SCHEMA_SQL run.
 */
export const dropDatabase = (): Promise<void> => resetSQLiteDatabase()
