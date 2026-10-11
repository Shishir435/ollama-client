import { isFileTypeSupported } from "@/lib/file-processors"
import type { ProcessedFile } from "@/lib/file-processors/types"
import {
  addFileToKnowledgeSet,
  getActiveKnowledgeSetId
} from "@/lib/knowledge/knowledge-sets"

/** Structured validation stays untranslated until the UI presents it. */
export class FileUploadValidationError extends Error {
  constructor(
    readonly reason: "unsupported_type" | "too_large",
    readonly fileName: string,
    readonly maxMb: number
  ) {
    super(
      reason === "too_large"
        ? "File exceeds maximum size"
        : "Unsupported file type"
    )
    this.name = "FileUploadValidationError"
  }
}

export const validateFileForUpload = (
  file: File,
  maxFileSize: number
): FileUploadValidationError | null => {
  const maxMb = Math.round(maxFileSize / 1024 / 1024)
  if (!isFileTypeSupported(file))
    return new FileUploadValidationError("unsupported_type", file.name, maxMb)
  if (file.size > maxFileSize)
    return new FileUploadValidationError("too_large", file.name, maxMb)
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
