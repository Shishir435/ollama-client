import Dexie, { type Table } from "dexie"
import type { NativeIndexState, NativeRebuildRow } from "./native/state"
import type { VectorDocument } from "./types"

class VectorDatabase extends Dexie {
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
  }
}

export const vectorDb = new VectorDatabase()
