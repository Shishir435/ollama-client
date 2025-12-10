import Dexie, { type Table } from "dexie"
import type { VectorDocument } from "./types"

class VectorDatabase extends Dexie {
  vectors!: Table<VectorDocument>

  constructor() {
    super("VectorDatabase")
    this.version(1).stores({
      vectors:
        "++id, metadata.type, metadata.sessionId, metadata.fileId, metadata.url, metadata.timestamp"
    })
  }
}

export const vectorDb = new VectorDatabase()
