import { isFileTypeSupported } from "@/lib/file-processors"
import type { ProcessedFile } from "@/lib/file-processors/types"
import {
  addFileToKnowledgeSet,
  getActiveKnowledgeSetId
} from "@/lib/knowledge/knowledge-sets"

export const validateFileForUpload = (
  file: File,
  maxFileSize: number
): Error | null => {
  if (!isFileTypeSupported(file)) {
    return new Error(
      `Unsupported file type: "${file.name}". Supported formats: Text files (.txt, .md, .js, .ts, etc.), PDF (.pdf), DOCX (.docx), CSV/TSV (.csv, .tsv), and HTML (.html).`
    )
  }

  if (file.size > maxFileSize) {
    return new Error(
      `File "${file.name}" exceeds maximum size of ${(maxFileSize / 1024 / 1024).toFixed(0)}MB`
    )
  }

  return null
}

export const ensureProcessedFileId = (result: ProcessedFile): string => {
  const fallbackId =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? `file-${crypto.randomUUID()}`
      : `file-${Date.now()}-${Math.random().toString(16).slice(2)}`
  const fileId = result.metadata.fileId || fallbackId
  result.metadata.fileId = fileId
  return fileId
}

export const registerKnowledgeFile = async (
  result: ProcessedFile,
  fileId: string
): Promise<void> => {
  const knowledgeSetId = await getActiveKnowledgeSetId()
  result.metadata.knowledgeSetId = knowledgeSetId
  await addFileToKnowledgeSet({
    id: fileId,
    knowledgeSetId,
    fileName: result.metadata.fileName,
    fileType: result.metadata.fileType,
    fileSize: result.metadata.fileSize,
    createdAt: result.metadata.processedAt || Date.now()
  })
}
