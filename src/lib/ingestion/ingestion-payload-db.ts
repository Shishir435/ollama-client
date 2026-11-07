import Dexie, { type Table } from "dexie"
import type { ProcessedFile } from "@/lib/file-processors/types"

interface IngestionPayloadBase {
  jobId: string
  fileId: string
  knowledgeSetId: string
  fileName: string
  contentType: string
  autoEmbed: boolean
  createdAt: number
}

export interface RawIngestionPayload extends IngestionPayloadBase {
  kind: "raw"
  bytes: ArrayBuffer
  lastModified: number
}

/**
 * `text` is absent when `pages` already hold it: a page-aware file keeps its
 * pages, which carry the page number chunk citations need, and `text` is
 * rebuilt from them on read rather than stored a second time.
 */
export type DurableProcessedFile = Omit<ProcessedFile, "metadata" | "text"> & {
  text?: string
  metadata: ProcessedFile["metadata"] & {
    fileId: string
    knowledgeSetId: string
  }
}

export interface ProcessedIngestionPayload extends IngestionPayloadBase {
  kind: "processed"
  processedFile: DurableProcessedFile
}

export type IngestionPayload = RawIngestionPayload | ProcessedIngestionPayload

class IngestionPayloadDatabase extends Dexie {
  payloads!: Table<IngestionPayload, string>

  constructor() {
    super("IngestionPayloadDatabase")
    this.version(2).stores({
      payloads: "jobId"
    })
  }
}

export const ingestionPayloadDb = new IngestionPayloadDatabase()
