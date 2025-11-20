import type { FileProcessor, ProcessedFile } from "@/lib/file-processors/types"

const BINARY_EXTENSIONS = [
  ".pdf",
  ".docx",
  ".doc",
  ".xlsx",
  ".xls",
  ".pptx",
  ".ppt",
  ".zip",
  ".tar",
  ".gz",
  ".rar",
  ".7z",
  ".exe",
  ".dll",
  ".so",
  ".dylib",
  ".bin",
  ".iso",
  ".img",
  ".dmg",
  ".pkg",
  ".deb",
  ".rpm",
  ".apk",
  ".ipa"
]

const BINARY_MIME_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/zip",
  "application/x-tar",
  "application/gzip",
  "application/x-rar-compressed",
  "application/x-7z-compressed",
  "application/x-msdownload",
  "application/x-sharedlib",
  "application/octet-stream",
  "application/x-iso9660-image"
]

export class TextProcessor implements FileProcessor {
  canProcess(file: File): boolean {
    const extension = this.getFileExtension(file.name).toLowerCase()

    if (BINARY_EXTENSIONS.includes(extension)) {
      return false
    }

    if (file.type && BINARY_MIME_TYPES.includes(file.type)) {
      return false
    }

    if (file.type?.startsWith("image/")) {
      return false
    }
    return true
  }

  async process(file: File): Promise<ProcessedFile> {
    try {
      const text = await file.text()

      return {
        text,
        metadata: {
          fileName: file.name,
          fileType: file.type || "text/plain",
          fileSize: file.size,
          processedAt: Date.now()
        }
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error"
      throw new Error(`Failed to process text file: ${errorMessage}`)
    }
  }

  private getFileExtension(fileName: string): string {
    const lastDot = fileName.lastIndexOf(".")
    return lastDot !== -1 ? fileName.slice(lastDot) : ""
  }
}
