import type { FileProcessor, ProcessedFile } from "@/lib/file-processors/types"

const TEXT_EXTENSIONS = [
  ".txt",
  ".md",
  ".markdown",
  ".js",
  ".ts",
  ".jsx",
  ".tsx",
  ".json",
  ".css",
  ".html",
  ".htm",
  ".xml",
  ".yaml",
  ".yml",
  ".csv",
  ".log",
  ".sh",
  ".bash",
  ".zsh",
  ".fish",
  ".ps1",
  ".bat",
  ".cmd"
]

const TEXT_MIME_TYPES = [
  "text/plain",
  "text/markdown",
  "text/javascript",
  "application/javascript",
  "text/typescript",
  "application/typescript",
  "application/json",
  "text/css",
  "text/html",
  "application/xml",
  "text/xml",
  "text/yaml",
  "application/x-yaml",
  "text/csv"
]

export class TextProcessor implements FileProcessor {
  canProcess(file: File): boolean {
    // Check by extension
    const extension = this.getFileExtension(file.name).toLowerCase()
    if (TEXT_EXTENSIONS.includes(extension)) {
      return true
    }

    // Check by MIME type
    if (file.type && TEXT_MIME_TYPES.includes(file.type)) {
      return true
    }

    // Fallback: if no extension and no MIME type, assume text
    if (!extension && !file.type) {
      return true
    }

    return false
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
