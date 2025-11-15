export interface ProcessedFile {
  text: string
  chunks?: string[]
  metadata: FileMetadata
}

export interface FileMetadata {
  fileName: string
  fileType: string
  fileSize: number
  pageCount?: number
  processedAt: number
  fileId?: string
}

export interface FileProcessor {
  canProcess(file: File): boolean
  process(file: File): Promise<ProcessedFile>
}

export type FileProcessingStatus = "idle" | "processing" | "success" | "error"

export interface FileProcessingState {
  file: File
  status: FileProcessingStatus
  result?: ProcessedFile
  error?: string
  progress?: number
}
