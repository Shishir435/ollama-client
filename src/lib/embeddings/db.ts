import Dexie, { type Table } from "dexie"
import type { NativeIndexState, NativeRebuildRow } from "./native/state"
import type { VectorDocument } from "./types"

class VectorDatabase extends Dexie {
  deletedSessions!: Table<{ sessionId: string }, string>
  messageState!: Table<
    { messageId: number; revision: string; deleted: boolean; token: string },
    number
  >
  vectors!: Table<VectorDocument>
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
  }
}

export const vectorDb = new VectorDatabase()
