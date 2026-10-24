import Dexie, { type Table } from "dexie"
import type { NativeIndexState, NativeRebuildRow } from "./native/state"
import type { VectorDocument } from "./types"
import {
  addDocumentToVectorStorageStats,
  emptyVectorStorageStats,
  type VectorStorageStats
} from "./vector-storage-stats"

class VectorDatabase extends Dexie {
  deletedSessions!: Table<{ sessionId: string }, string>
  messageState!: Table<
    {
      messageId: number
      revision: string
      deleted: boolean
      token: string
      reason?: "deleted" | "editing" | "cleared"
    },
    number
  >
  vectors!: Table<VectorDocument>
  vectorStats!: Table<VectorStorageStats, string>
  embeddingState!: Table<NativeIndexState, string>
  embeddingRebuild!: Table<NativeRebuildRow, number>

  constructor() {
    super("VectorDatabase")
    this.version(1).stores({
      vectors:
        "++id, metadata.type, metadata.sessionId, metadata.fileId, metadata.url, metadata.timestamp"
    })

    this.version(3).stores({
      embeddingState: "id",
      embeddingRebuild: "id"
    })
    this.version(2).stores({
      vectors:
        "++id, metadata.type, metadata.sessionId, metadata.fileId, metadata.url, metadata.timestamp, metadata.messageId"
    })
    this.version(4).stores({
      messageState: "messageId",
      deletedSessions: "sessionId"
    })
    this.version(5)
      .stores({ vectorStats: "id" })
      .upgrade(async (transaction) => {
        const stats = emptyVectorStorageStats()
        await transaction.table("vectors").each((document: VectorDocument) => {
          addDocumentToVectorStorageStats(stats, document)
        })
        await transaction.table("vectorStats").put(stats)
      })
    this.version(6)
      .stores({ embeddingRebuild: "id, [pending+id]" })
      .upgrade(async (transaction) => {
        await transaction
          .table("embeddingRebuild")
          .toCollection()
          .modify((row: { embedding?: number[]; pending?: 0 | 1 }) => {
            row.pending = row.embedding ? 0 : 1
          })
      })
  }
}

export const vectorDb = new VectorDatabase()
