import Dexie, { type Table } from "dexie"
import type { ProcessedFile } from "@/lib/file-processors/types"

export interface IngestionPayload {
  jobId: string
  contentType: string
  processedFile: ProcessedFile
}

class IngestionPayloadDatabase extends Dexie {
  payloads!: Table<IngestionPayload, string>

  constructor() {
    super("IngestionPayloadDatabase")
    this.version(1).stores({
      payloads: "jobId"
    })
  }
}

export const ingestionPayloadDb = new IngestionPayloadDatabase()
