import {
  ChatMessageErrorSchema,
  ChatMessageMetricsSchema
} from "@ollama-client/contracts/chat"
import { TURN_OWNED_ASSISTANT_STATUSES } from "@ollama-client/contracts/turns"
import { z } from "zod"
import { imageToStoredFile } from "@/lib/image-utils"
import { PERSISTENCE_LIMITS } from "@/lib/persistence/protocol"
import {
  parseStoredReplayArtifact,
  serializeReplayArtifact
} from "@/lib/providers/provider-replay"
import type { SqlExecutor } from "@/lib/sqlite/db"
import {
  flushSave,
  query,
  resetSQLiteDatabase,
  run,
  runWithMeta,
  withTransaction
} from "@/lib/sqlite/db"
import type { ChatMessage, ChatSession, FileAttachment, Role } from "@/types"
import { decodeRows } from "./row-decoder"

/**
 * SQLite-backed implementation of the chat-history persistence surface.
 *
 * The migration-time class `SQLiteChatRepository` is kept separately
 * because it has migration-specific helpers (addMessageIfNotExists,
 * addFileIfNotExists) that callers should not see at runtime. This
 * module is the *runtime* surface.
 */

type StoredMessage = ChatMessage & { sessionId: string; id?: number }
type StoredFile = FileAttachment & { sessionId: string; id?: number }

/**
 * Narrow message projection: the columns the message tree is built from.
 *
 * Decoded rather than asserted, unlike the whole-row mappers below. These three
 * values *are* the ancestry — a null id or a timestamp that is not a number
 * does not surface as a rendering glitch, it reorders siblings or detaches a
 * subtree, and the visible branch silently ends early with nothing to point at.
 * A per-field `as` on a bag of `SqlValue`s is unconditionally true and
 * unconditionally unchecked, so the first thing to notice would be the user.
 */
const MessageTreeRowSchema = z.object({
  id: z.number(),
  parentId: z
    .number()
    .nullish()
    .transform((value) => value ?? undefined),
  timestamp: z.number()
})

export type MessageTreeRow = z.infer<typeof MessageTreeRowSchema>

type RowValue = string | number | null | Uint8Array
type Row = Record<string, RowValue>

/** Force pending chat-history writes through the SQLite durability boundary. */
export const flushChatHistory = (): Promise<void> => flushSave()

const parseTags = (raw: RowValue): string[] => {
  if (typeof raw !== "string" || raw.length === 0) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed)
      ? parsed.filter((tag): tag is string => typeof tag === "string")
      : []
  } catch {
    return []
  }
}

const sessionFromRow = (row: Row): ChatSession => {
  const systemPrompt = (row.systemPrompt as string | null) ?? undefined
  const tags = parseTags(row.tags)
  return {
    id: row.id as string,
    title: (row.title as string) ?? "",
    modelId: (row.modelId as string | null) ?? undefined,
    currentLeafId: (row.currentLeafId as number | null) ?? undefined,
    createdAt: row.createdAt as number,
    updatedAt: row.updatedAt as number,
    pinned: row.pinned === 1,
    ...(systemPrompt ? { systemPrompt } : {}),
    ...(tags.length > 0 ? { tags } : {}),
    messages: []
  }
}

const parseMetrics = (raw: RowValue): ChatMessage["metrics"] => {
  if (typeof raw !== "string" || raw.length === 0) return undefined
  try {
    const parsed = JSON.parse(raw)
    const result = ChatMessageMetricsSchema.safeParse(parsed)
    return result.success ? (result.data as ChatMessage["metrics"]) : undefined
  } catch {
    return undefined
  }
}

const parseMessageError = (raw: RowValue): ChatMessage["error"] => {
  if (typeof raw !== "string" || raw.length === 0) return undefined
  try {
    const result = ChatMessageErrorSchema.safeParse(JSON.parse(raw))
    return result.success ? result.data : undefined
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
  thinking: (row.thinking as string | null) ?? undefined,
  replayArtifact: parseStoredReplayArtifact(row.replayArtifact),
  error: parseMessageError(row.error)
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

/** Build a `?, ?, ?` placeholder list for an IN clause. */
const placeholders = (n: number) => Array(n).fill("?").join(", ")

const idBatches = (ids: number[]): number[][] => {
  const batches: number[][] = []
  for (
    let offset = 0;
    offset < ids.length;
    offset += PERSISTENCE_LIMITS.bindValues
  ) {
    batches.push(ids.slice(offset, offset + PERSISTENCE_LIMITS.bindValues))
  }
  return batches
}

const normalizeFileData = (data: unknown): Uint8Array | undefined => {
  if (data instanceof Uint8Array) return data
  if (Array.isArray(data)) return new Uint8Array(data)
  // Index-keyed object form ({"0":..,"1":..}) from a JSON-serialized
  // Uint8Array. Integer-like keys iterate in ascending order, preserving bytes.
  if (data && typeof data === "object") {
    return new Uint8Array(Object.values(data as Record<string, number>))
  }
  return undefined
}

const insertImportedMessage = async (
  sessionId: string,
  message: ChatMessage,
  executor: Pick<SqlExecutor, "runWithMeta"> = { runWithMeta }
): Promise<number> => {
  // Always allocate a fresh autoincrement id. messages.id is a GLOBAL primary
  // key (not per-session), so reusing the exported id via INSERT OR REPLACE
  // would silently overwrite a colliding message belonging to a *different*
  // existing session. parentId is written null here and remapped in a second
  // pass once the full old→new id map for this session is known.
  // runWithMeta reports lastInsertRowid from the same owner-side operation,
  // which is the only race-free read on the shared OPFS connection.
  const { lastInsertRowid } = await executor.runWithMeta(
    `INSERT INTO messages
     (sessionId, role, content, model, timestamp, parentId, done, metrics, thinking, replayArtifact, error)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      sessionId,
      message.role,
      message.content,
      message.model ?? null,
      message.timestamp ?? Date.now(),
      null,
      message.done === false ? 0 : 1,
      message.metrics ? JSON.stringify(message.metrics) : null,
      message.thinking ?? null,
      serializeReplayArtifact(message.replayArtifact),
      message.error ? JSON.stringify(message.error) : null
    ]
  )
  return lastInsertRowid
}

const putSessionRow = async (
  session: ChatSession,
  executor: Pick<SqlExecutor, "run"> = { run }
): Promise<void> => {
  await executor.run(
    `INSERT OR REPLACE INTO sessions (id, title, modelId, currentLeafId, createdAt, updatedAt, pinned, systemPrompt, tags)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      session.id,
      session.title ?? null,
      session.modelId ?? null,
      typeof session.currentLeafId === "number" ? session.currentLeafId : null,
      session.createdAt,
      session.updatedAt,
      session.pinned ? 1 : 0,
      session.systemPrompt ?? null,
      session.tags?.length ? JSON.stringify(session.tags) : null
    ]
  )
}

/** ----- Sessions ------------------------------------------------------------ */

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
    `INSERT INTO sessions (id, title, modelId, currentLeafId, createdAt, updatedAt, pinned, systemPrompt, tags)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      session.id,
      session.title ?? null,
      session.modelId ?? null,
      typeof session.currentLeafId === "number" ? session.currentLeafId : null,
      session.createdAt,
      session.updatedAt,
      session.pinned ? 1 : 0,
      session.systemPrompt ?? null,
      session.tags?.length ? JSON.stringify(session.tags) : null
    ]
  )
  return session.id
}

export const bulkPutSessions = async (
  sessions: ChatSession[]
): Promise<void> => {
  for (const session of sessions) {
    if (!session.messages || session.messages.length === 0) {
      await putSessionRow(session)
      continue
    }

    await withTransaction(async (transaction) => {
      const messages = session.messages ?? []
      await putSessionRow(session, transaction)
      await transaction.run("DELETE FROM files WHERE sessionId = ?", [
        session.id
      ])
      await transaction.run("DELETE FROM messages WHERE sessionId = ?", [
        session.id
      ])

      // Pass 1: insert each message with a fresh id, record old→new, and
      // persist its files (which need the new message id).
      const idMap = new Map<number, number>()
      for (const message of messages) {
        const oldId = typeof message.id === "number" ? message.id : undefined
        const messageId = await insertImportedMessage(
          session.id,
          message,
          transaction
        )
        if (oldId !== undefined) idMap.set(oldId, messageId)

        const fileRows = [
          ...(message.attachments?.map((file) => ({
            ...file,
            data: normalizeFileData(file.data),
            sessionId: session.id,
            messageId
          })) ?? []),
          ...(message.images?.map((image) =>
            imageToStoredFile(image, messageId, session.id)
          ) ?? [])
        ]
        if (fileRows.length > 0) {
          await insertFiles(fileRows, transaction)
        }
      }

      // Pass 2: remap parentId links to the freshly-allocated ids.
      for (const message of messages) {
        const oldId = typeof message.id === "number" ? message.id : undefined
        const oldParentId =
          typeof message.parentId === "number" ? message.parentId : undefined
        if (oldId === undefined || oldParentId === undefined) continue
        const newId = idMap.get(oldId)
        const newParentId = idMap.get(oldParentId)
        if (newId === undefined || newParentId === undefined) continue
        await transaction.run("UPDATE messages SET parentId = ? WHERE id = ?", [
          newParentId,
          newId
        ])
      }

      // Remap the session's current-leaf pointer; clear it if the referenced
      // message wasn't part of the import (avoids a dangling cross-session ref
      // that putSessionRow's raw copy would otherwise leave).
      const newLeafId =
        typeof session.currentLeafId === "number"
          ? (idMap.get(session.currentLeafId) ?? null)
          : null
      await transaction.run(
        "UPDATE sessions SET currentLeafId = ? WHERE id = ?",
        [newLeafId, session.id]
      )
    })
  }

  // Imported data was just committed inside transactions, but persistence to
  // IndexedDB is debounced. Flush now so a sidepanel/worker teardown within the
  // debounce window can't lose an import the UI already reported as succeeded.
  await flushSave()
}

const updateSessionWithExecutor = async (
  id: string,
  updates: Partial<ChatSession>,
  executor: Pick<SqlExecutor, "run">
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
  if (Object.hasOwn(updates, "pinned")) {
    fields.push("pinned = ?")
    values.push(updates.pinned ? 1 : 0)
  }
  if (Object.hasOwn(updates, "systemPrompt")) {
    fields.push("systemPrompt = ?")
    values.push(updates.systemPrompt ?? null)
  }
  if (Object.hasOwn(updates, "tags")) {
    fields.push("tags = ?")
    values.push(updates.tags?.length ? JSON.stringify(updates.tags) : null)
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
  await executor.run(
    `UPDATE sessions SET ${fields.join(", ")} WHERE id = ?`,
    values
  )
  return 1
}

export const updateSession = (
  id: string,
  updates: Partial<ChatSession>
): Promise<number> => updateSessionWithExecutor(id, updates, { run })

export const deleteSessionRow = async (id: string): Promise<void> => {
  await run("DELETE FROM sessions WHERE id = ?", [id])
}

/** ----- Messages ------------------------------------------------------------ */

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

/**
 * The `id`/`parentId`/`timestamp` triple every message in a session
 * contributes to the tree: enough to build the siblings map and walk the
 * active path, and nothing else. Reading whole rows to do that shipped every
 * message body, attachment blob and inlined image across the persistence
 * worker's structured clone on each session switch, to keep fifty.
 */
export const getMessageTreeBySession = async (
  sessionId: string
): Promise<MessageTreeRow[]> => {
  const rows = await query(
    "SELECT id, parentId, timestamp FROM messages WHERE sessionId = ? ORDER BY timestamp ASC",
    [sessionId]
  )
  // Drop-and-log rather than raise: one unreadable row must not deny the user
  // the rest of the conversation. Its descendants lose their ancestor and fall
  // out of the walked path, which is a bounded, logged loss instead of a tree
  // built on a NaN id.
  return decodeRows(MessageTreeRowSchema, rows, {
    table: "messages",
    operation: "getMessageTreeBySession"
  })
}

export const getMessagesByIds = async (
  ids: Array<number | string>
): Promise<StoredMessage[]> => {
  if (ids.length === 0) return []
  const numericIds = ids.map((id) => Number(id))
  const rows = await query(
    `SELECT * FROM messages WHERE id IN (${placeholders(numericIds.length)})`,
    numericIds
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

const insertMessage = async (
  message: Omit<StoredMessage, "id">,
  executor: Pick<SqlExecutor, "runWithMeta">
): Promise<number> => {
  const timestamp = message.timestamp ?? Date.now()
  const { lastInsertRowid } = await executor.runWithMeta(
    `INSERT INTO messages
     (sessionId, role, content, model, timestamp, parentId, done, metrics, thinking, replayArtifact, error, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      message.sessionId,
      message.role,
      message.content,
      message.model ?? null,
      timestamp,
      typeof message.parentId === "number" ? message.parentId : null,
      message.done === false ? 0 : 1,
      message.metrics ? JSON.stringify(message.metrics) : null,
      message.thinking ?? null,
      serializeReplayArtifact(message.replayArtifact),
      message.error ? JSON.stringify(message.error) : null,
      // Seed last-touched at creation so a shell that dies before its first
      // streaming write still ages into "stale" for the interrupted sweep.
      timestamp
    ]
  )
  return lastInsertRowid
}

export const addMessage = (
  message: Omit<StoredMessage, "id">
): Promise<number> => insertMessage(message, { runWithMeta })

/**
 * Atomically append a message, its files, and the session's active-leaf
 * pointer. A live session snapshot may be supplied to repair a missing session
 * row — originally for rows lost to a stale or competing per-page database,
 * which a single owner no longer produces. The repair stays because the caller
 * can still reach here with a session the database has not seen: a UI that
 * optimistically created one, or a restore that landed between the two writes.
 */
export const appendMessage = async (
  message: Omit<StoredMessage, "id">,
  files: Array<FileAttachment & { sessionId: string; messageId?: number }> = [],
  session?: ChatSession
): Promise<number> => {
  let messageId: number | undefined

  await withTransaction(async (transaction) => {
    const existing = await transaction.query(
      "SELECT id FROM sessions WHERE id = ?",
      [message.sessionId]
    )
    if (existing.length === 0) {
      if (!session || session.id !== message.sessionId) {
        throw new Error(`Session ${message.sessionId} was not found`)
      }
      await putSessionRow(session, transaction)
    }

    messageId = await insertMessage(message, transaction)
    if (files.length > 0) {
      await insertFiles(
        files.map((file) => ({ ...file, messageId: messageId as number })),
        transaction
      )
    }
    await updateSessionWithExecutor(
      message.sessionId,
      {
        updatedAt: Date.now(),
        currentLeafId: messageId
      },
      transaction
    )
  })

  if (messageId === undefined) {
    throw new Error("Message append completed without an id")
  }
  return messageId
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
  if (Object.hasOwn(updates, "replayArtifact")) {
    fields.push("replayArtifact = ?")
    values.push(serializeReplayArtifact(updates.replayArtifact))
  }
  if (Object.hasOwn(updates, "error")) {
    fields.push("error = ?")
    values.push(updates.error ? JSON.stringify(updates.error) : null)
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

  // Stamp last-touched on every write. Streaming partial-content writes land
  // here ~1s apart, keeping a live turn's row fresh so the interrupted sweep
  // (which finalizes only stale rows) never mistakes it for an orphan.
  fields.push("updatedAt = ?")
  values.push(Date.now())

  values.push(id)
  await run(`UPDATE messages SET ${fields.join(", ")} WHERE id = ?`, values)
  return 1
}

/**
 * Finalize assistant turns left in-flight (`done=0`) by a worker/sidepanel
 * death mid-stream. Marks each done and flags `metrics.interrupted` so the UI
 * can surface the partial answer as interrupted and offer a retry.
 *
 * Ownership is enforced inside the query, so there is no separate liveness
 * check to race:
 *   - Durable-turn ownership: an assistant row referenced by an incomplete
 *     `turn_runs` row is background-owned and never finalized here. Restart
 *     recovery resumes or fails that run explicitly.
 *   - Legacy staleness: a row without a durable owner is finalized only if it
 *     has not been written within `staleMs`. Its UI bridge refreshes
 *     `updatedAt`; a `NULL` value (rows predating the column) is stale.
 *   - Tool-loop ownership: a turn awaiting tool approval can legitimately go
 *     minutes without a message write while its durable `tool_loop_runs`
 *     checkpoint is live. Excluding sessions that have any checkpoint row
 *     keeps those live waits from being finalized (rows are deleted on
 *     completion and pruned when abandoned).
 *
 * Returns the count fixed.
 */
/**
 * Statuses whose turn still owns its assistant row. Interpolated from the
 * contract rather than spelled out, because a status added there and missed
 * here is invisible: the sweep just starts finalizing rows it does not own.
 */
const OWNED_ASSISTANT_STATUS_LIST = TURN_OWNED_ASSISTANT_STATUSES.map(
  (status) => `'${status}'`
).join(", ")

export const finalizeInterruptedMessages = async (
  staleMs = 20_000
): Promise<number> => {
  const cutoff = Date.now() - staleMs
  const rows = await query(
    `SELECT id, metrics FROM messages
     WHERE role = 'assistant' AND done = 0
       AND (updatedAt IS NULL OR updatedAt < ?)
       AND id NOT IN (
         SELECT assistantMessageId FROM turn_runs
         WHERE assistantMessageId IS NOT NULL
           AND status IN (${OWNED_ASSISTANT_STATUS_LIST})
       )
       AND sessionId NOT IN (
         SELECT sessionId FROM tool_loop_runs WHERE sessionId IS NOT NULL
       )`,
    [cutoff]
  )
  if (rows.length === 0) return 0

  for (const row of rows) {
    const metrics = { ...(parseMetrics(row.metrics) ?? {}), interrupted: true }
    await run("UPDATE messages SET done = 1, metrics = ? WHERE id = ?", [
      JSON.stringify(metrics),
      row.id as number
    ])
  }
  await flushSave()
  return rows.length
}

/**
 * Refresh a message's `updatedAt` without changing its content — a per-turn
 * liveness beat. The streaming client calls this on a timer while a turn is in
 * flight (independent of token arrival), so a slow or quiet provider (long
 * time-to-first-token, long gaps between tokens) keeps its row fresh and the
 * interrupted sweep never mistakes a live turn for an orphan. Deliberately not
 * force-flushed: the 1s autosave carries it, and being a beat or two behind is
 * harmless against the multi-second staleness window.
 */
export const touchMessageActivity = async (id: number): Promise<void> => {
  await run("UPDATE messages SET updatedAt = ? WHERE id = ?", [Date.now(), id])
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

export interface DeletedMessageSubtree {
  sessionId: string
  messageIds: number[]
  repairedLeaf: boolean
  replacementLeafId?: number
}

/**
 * Delete one message and every descendant as a single SQLite commit.
 *
 * Descendant discovery belongs inside the transaction: computing the tree in
 * the UI before opening the transaction lets a concurrent append escape the
 * delete. Files have no message foreign key, so they must be removed in the
 * same transaction rather than relying on cascade behavior.
 */
export const deleteMessageSubtree = async (
  messageId: number
): Promise<DeletedMessageSubtree | undefined> => {
  let deleted: DeletedMessageSubtree | undefined

  await withTransaction(async (transaction) => {
    const targetRows = await transaction.query(
      "SELECT sessionId, parentId FROM messages WHERE id = ?",
      [messageId]
    )
    const target = targetRows[0]
    if (!target || typeof target.sessionId !== "string") return

    const sessionId = target.sessionId
    const replacementLeafId =
      typeof target.parentId === "number" ? target.parentId : undefined
    const descendantRows = await transaction.query(
      `WITH RECURSIVE descendants(id) AS (
         SELECT id FROM messages WHERE id = ? AND sessionId = ?
         UNION
         SELECT child.id FROM messages child
         JOIN descendants parent ON child.parentId = parent.id
         WHERE child.sessionId = ?
       )
       SELECT id FROM descendants ORDER BY id`,
      [messageId, sessionId, sessionId]
    )
    const messageIds = descendantRows.flatMap((row) =>
      typeof row.id === "number" ? [row.id] : []
    )
    if (messageIds.length === 0) return

    const sessionRows = await transaction.query(
      "SELECT currentLeafId FROM sessions WHERE id = ?",
      [sessionId]
    )
    const currentLeafId = sessionRows[0]?.currentLeafId
    const repairedLeaf =
      typeof currentLeafId === "number" && messageIds.includes(currentLeafId)

    if (repairedLeaf) {
      await transaction.run(
        "UPDATE sessions SET currentLeafId = ? WHERE id = ?",
        [replacementLeafId ?? null, sessionId]
      )
    }
    const batches = idBatches(messageIds)
    const createdAt = Date.now()
    for (const id of messageIds) {
      await transaction.run(
        `INSERT OR IGNORE INTO vector_cleanup_receipts (messageId, createdAt)
         VALUES (?, ?)`,
        [id, createdAt]
      )
    }
    for (const batch of batches) {
      await transaction.run(
        `DELETE FROM files WHERE messageId IN (${placeholders(batch.length)})`,
        batch
      )
    }
    for (const batch of batches) {
      await transaction.run(
        `DELETE FROM messages WHERE id IN (${placeholders(batch.length)})`,
        batch
      )
    }

    deleted = {
      sessionId,
      messageIds,
      repairedLeaf,
      ...(replacementLeafId === undefined ? {} : { replacementLeafId })
    }
  })

  return deleted
}

/** ----- Files --------------------------------------------------------------- */

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

const insertFiles = async (
  files: Array<FileAttachment & { sessionId: string; messageId?: number }>,
  executor: Pick<SqlExecutor, "run">
): Promise<void> => {
  for (const file of files) {
    const blob = file.data instanceof Uint8Array ? file.data : null
    await executor.run(
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

export const bulkAddFiles = (
  files: Array<FileAttachment & { sessionId: string; messageId?: number }>
): Promise<void> => insertFiles(files, { run })

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

/**
 * Drop the SQLite-backed chat database. Used by the user-facing
 * "reset all app data" flow. The next read will recreate the schema
 * via `initSQLite()`'s SCHEMA_SQL run.
 */
export const dropDatabase = (): Promise<void> => resetSQLiteDatabase()
