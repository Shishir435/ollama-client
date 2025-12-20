import { logger } from "@/lib/logger"
import { query, run } from "@/lib/sqlite/db"
import type { ChatMessage, ChatSession, FileAttachment, Role } from "@/types"
import type { ChatRepository } from "./types"

export class SQLiteChatRepository implements ChatRepository {
  async createSession(session: ChatSession): Promise<void> {
    await run(
      `INSERT INTO sessions (id, title, modelId, currentLeafId, createdAt, updatedAt) 
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        session.id,
        session.title || null,
        session.modelId,
        session.currentLeafId || null,
        session.createdAt,
        session.updatedAt
      ]
    )
  }

  async getSession(id: string): Promise<ChatSession | undefined> {
    const results = await query(`SELECT * FROM sessions WHERE id = ?`, [id])
    if (results.length === 0) return undefined

    const row = results[0]
    return {
      id: row.id as string,
      title: (row.title as string) || undefined,
      modelId: row.modelId as string,
      currentLeafId: (row.currentLeafId as number) || undefined,
      createdAt: row.createdAt as number,
      updatedAt: row.updatedAt as number,
      messages: []
    }
  }

  async getAllSessions(): Promise<ChatSession[]> {
    const rows = await query(`SELECT * FROM sessions ORDER BY updatedAt DESC`)
    return rows.map((row) => ({
      id: row.id as string,
      title: row.title as string | undefined,
      modelId: row.modelId as string,
      currentLeafId: row.currentLeafId as number | undefined,
      createdAt: row.createdAt as number,
      updatedAt: row.updatedAt as number,
      messages: []
    }))
  }

  async updateSession(
    id: string,
    updates: Partial<ChatSession>
  ): Promise<void> {
    const fields = []
    const values = []

    if (updates.title !== undefined) {
      fields.push("title = ?")
      values.push(updates.title)
    }
    if (updates.modelId !== undefined) {
      fields.push("modelId = ?")
      values.push(updates.modelId)
    }
    if (updates.currentLeafId !== undefined) {
      fields.push("currentLeafId = ?")
      values.push(updates.currentLeafId)
    }
    if (updates.updatedAt !== undefined) {
      fields.push("updatedAt = ?")
      values.push(updates.updatedAt)
    }

    if (fields.length === 0) return

    values.push(id)
    await run(`UPDATE sessions SET ${fields.join(", ")} WHERE id = ?`, values)
  }

  async deleteSession(id: string): Promise<void> {
    await run(`DELETE FROM sessions WHERE id = ?`, [id])
  }

  async getMessages(sessionId: string): Promise<ChatMessage[]> {
    const rows = await query(
      `SELECT * FROM messages WHERE sessionId = ? ORDER BY timestamp ASC`,
      [sessionId]
    )

    // We also need to fetch attachments for these messages
    // To be efficient, we might want to do a join or separate query
    // For now, let's keep it simple and just return messages, assuming files are loaded on demand or we fetch them here
    // But the types say ChatMessage contains optional attachments.
    // Let's fetch files for this session to map them.
    const files = await this.getFiles(sessionId)
    const fileMap = new Map<number, FileAttachment[]>()

    for (const file of files) {
      if (file.messageId) {
        const existing = fileMap.get(file.messageId) || []
        existing.push(file)
        fileMap.set(file.messageId, existing)
      }
    }

    return rows.map((row) => ({
      id: row.id as number,
      role: row.role as Role,
      content: row.content as string,
      model: row.model as string | undefined,
      timestamp: row.timestamp as number,
      parentId: row.parentId as number | undefined,
      done: Boolean(row.done),
      metrics: row.metrics ? JSON.parse(row.metrics as string) : undefined,
      attachments: fileMap.get(row.id as number) || []
    }))
  }

  async addMessage(
    sessionId: string,
    message: ChatMessage & { parentId?: number }
  ): Promise<number> {
    await run(
      `INSERT INTO messages (sessionId, role, content, model, timestamp, parentId, done, metrics)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        sessionId,
        message.role,
        message.content,
        message.model || null,
        message.timestamp,
        message.parentId || null,
        message.done ? 1 : 0,
        message.metrics ? JSON.stringify(message.metrics) : null
      ]
    )

    const result = await query(`SELECT last_insert_rowid() as id`)
    return result[0].id as number
  }

  // Migration-specific method: Insert message only if it doesn't already exist (idempotent)
  async addMessageIfNotExists(
    sessionId: string,
    message: ChatMessage & { parentId?: number }
  ): Promise<number | null> {
    // Check if message with same timestamp and content already exists
    // Using timestamp + content as a reasonable uniqueness check for migration
    if (message.timestamp) {
      const existing = await query(
        `SELECT id FROM messages WHERE sessionId = ? AND timestamp = ? AND content = ? LIMIT 1`,
        [sessionId, message.timestamp, message.content]
      )
      if (existing.length > 0) {
        logger.info(
          `Message at timestamp ${message.timestamp} already exists, skipping`,
          "SQLiteChatRepository"
        )
        return existing[0].id as number
      }
    }

    return await this.addMessage(sessionId, message)
  }

  async updateMessage(
    id: number,
    updates: Partial<ChatMessage>
  ): Promise<void> {
    const fields = []
    const values = []

    if (updates.content !== undefined) {
      fields.push("content = ?")
      values.push(updates.content)
    }
    if (updates.done !== undefined) {
      fields.push("done = ?")
      values.push(updates.done ? 1 : 0)
    }
    if (updates.metrics !== undefined) {
      fields.push("metrics = ?")
      values.push(JSON.stringify(updates.metrics))
    }

    if (fields.length === 0) return

    values.push(id)
    await run(`UPDATE messages SET ${fields.join(", ")} WHERE id = ?`, values)
  }

  async deleteMessage(id: number): Promise<void> {
    await run(`DELETE FROM messages WHERE id = ?`, [id])
  }

  async addFile(
    file: FileAttachment & {
      sessionId: string
      messageId?: number
      data?: Blob | Uint8Array
    }
  ): Promise<number> {
    // Convert Blob to Uint8Array if needed
    let fileData: Uint8Array | null = null
    if (file.data) {
      if (file.data instanceof Blob) {
        const arrayBuffer = await file.data.arrayBuffer()
        fileData = new Uint8Array(arrayBuffer)
      } else if (file.data instanceof Uint8Array) {
        fileData = file.data
      }
    }

    await run(
      `INSERT INTO files (fileId, sessionId, messageId, fileType, fileName, fileSize, processedAt, data)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        file.fileId,
        file.sessionId,
        file.messageId || null,
        file.fileType,
        file.fileName || null,
        file.fileSize || 0,
        file.processedAt || Date.now(),
        fileData
      ]
    )
    const result = await query(`SELECT last_insert_rowid() as id`)
    return result[0].id as number
  }

  // Migration-specific method: Insert file only if it doesn't exist (idempotent)
  async addFileIfNotExists(
    file: FileAttachment & {
      sessionId: string
      messageId?: number
      data?: Blob | Uint8Array
    }
  ): Promise<boolean> {
    // Check if file already exists
    const existing = await query(
      `SELECT id FROM files WHERE fileId = ? AND sessionId = ?`,
      [file.fileId, file.sessionId]
    )
    if (existing.length > 0) {
      logger.info(
        `File ${file.fileId} already exists, skipping`,
        "SQLiteChatRepository"
      )
      return false
    }

    await this.addFile(file)
    return true
  }

  async getFiles(sessionId: string): Promise<FileAttachment[]> {
    const rows = await query(`SELECT * FROM files WHERE sessionId = ?`, [
      sessionId
    ])
    return rows.map((row) => ({
      id: row.id as number,
      fileId: row.fileId as string,
      sessionId: row.sessionId as string,
      messageId: row.messageId as number | undefined,
      fileType: row.fileType as string,
      fileName: row.fileName as string,
      fileSize: row.fileSize as number,
      processedAt: row.processedAt as number,
      data: row.data as Uint8Array
    }))
  }

  async getFile(id: number): Promise<FileAttachment | undefined> {
    const rows = await query(`SELECT * FROM files WHERE id = ?`, [id])
    if (rows.length === 0) return undefined

    const row = rows[0]
    return {
      id: row.id as number,
      fileId: row.fileId as string,
      sessionId: row.sessionId as string,
      messageId: row.messageId as number | undefined,
      fileType: row.fileType as string,
      fileName: row.fileName as string,
      fileSize: row.fileSize as number,
      processedAt: row.processedAt as number,
      data: row.data as Uint8Array
    }
  }
}
