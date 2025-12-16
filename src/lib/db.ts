import Dexie, { type Table } from "dexie"

import type { ChatMessage, ChatSession, FileAttachment } from "@/types"

class ChatDatabase extends Dexie {
  sessions!: Table<ChatSession>

  messages!: Table<ChatMessage & { sessionId: string; id?: number }>
  files!: Table<FileAttachment & { sessionId: string; id?: number }>

  constructor() {
    super("ChatDatabase")

    // Version 1: Single table with embedded messages
    this.version(1).stores({
      sessions: "id, createdAt, updatedAt"
    })

    // Version 2: Normalized schema
    this.version(2)
      .stores({
        sessions: "id, createdAt, updatedAt, modelId",
        messages: "++id, sessionId, role, timestamp, [sessionId+timestamp]",
        files: "++id, fileId, messageId, sessionId, fileType, processedAt"
      })
      .upgrade(async (tx) => {
        // Migrate existing sessions to new schema
        const sessions = await tx.table("sessions").toArray()

        for (const session of sessions) {
          if (!session.messages || session.messages.length === 0) continue

          const messagesToAdd = []
          const filesToAdd = []

          for (let i = 0; i < session.messages.length; i++) {
            const msg = session.messages[i]

            // Prepare message for new table with timestamp for ordering
            // Use existing timestamp or create incrementing timestamps to preserve order
            const messageToAdd = {
              role: msg.role,
              content: msg.content,
              model: msg.model,
              done: msg.done,
              metrics: msg.metrics,
              sessionId: session.id,
              timestamp: msg.timestamp || session.createdAt + i * 1000
            }
            messagesToAdd.push(messageToAdd)
          }

          // Batch add messages first to get their IDs
          if (messagesToAdd.length > 0) {
            const messageKeys = await tx
              .table("messages")
              .bulkAdd(messagesToAdd, { allKeys: true })

            // Now extract attachments with their messageId
            for (let i = 0; i < session.messages.length; i++) {
              const msg = session.messages[i]
              const messageId = messageKeys[i] as number

              if (msg.attachments && msg.attachments.length > 0) {
                for (const attachment of msg.attachments) {
                  filesToAdd.push({
                    ...attachment,
                    messageId,
                    sessionId: session.id
                  })
                }
              }
            }
          }

          // Add files (messages already added above)
          if (filesToAdd.length > 0) {
            await tx.table("files").bulkAdd(filesToAdd)
          }

          // Update session to remove messages (optional, but saves space)
          // clean session object
          const { messages: _messages, ...cleanSession } = session
          await tx.table("sessions").put(cleanSession)
        }
      })

    // Version 3: Tree-based history (Forking)
    this.version(3)
      .stores({
        sessions: "id, createdAt, updatedAt, modelId",
        messages:
          "++id, sessionId, role, timestamp, parentId, [sessionId+timestamp]"
      })
      .upgrade(async (tx) => {
        // Migration: Link existing messages linearly
        const sessions = await tx.table("sessions").toArray()

        for (const session of sessions) {
          const messages = await tx
            .table("messages")
            .where("sessionId")
            .equals(session.id)
            .sortBy("timestamp")

          if (messages.length === 0) continue

          let prevId: number | undefined

          for (const msg of messages) {
            if (prevId !== undefined) {
              await tx.table("messages").update(msg.id, { parentId: prevId })
            }
            prevId = msg.id
          }

          // Set currentLeafId to the last message
          if (prevId) {
            await tx
              .table("sessions")
              .update(session.id, { currentLeafId: prevId })
          }
        }
      })
  }
}

export const db = new ChatDatabase()
