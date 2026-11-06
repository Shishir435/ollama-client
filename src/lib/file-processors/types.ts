export interface ProcessedFile {
  text: string
  chunks?: string[]
  pages?: Array<{ pageNumber: number; text: string }>
  metadata: FileMetadata
}

export interface FileMetadata {
  fileName: string
  fileType: string
  fileSize: number
  pageCount?: number
  processedAt: number
  fileId?: string
  knowledgeSetId?: string
  processingTime?: number
}

export interface FileProcessor {
  canProcess(file: File): boolean
  process(file: File, signal?: AbortSignal): Promise<ProcessedFile>
}

export type FileProcessingStatus =
  | "idle"
  /** Accepted and waiting behind another file; nothing is running for it yet. */
  | "queued"
  | "processing"
  | "success"
  | "error"

export interface FileProcessingState {
  file: File
  status: FileProcessingStatus
  result?: ProcessedFile
  error?: string
  progress?: number
}
