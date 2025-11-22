import type { FileProcessor, ProcessedFile } from "@/lib/file-processors/types"

// Lazy load mammoth to reduce initial bundle size
let mammothLib: typeof import("mammoth") | null = null

async function getMammothLib() {
  if (!mammothLib) {
    mammothLib = await import("mammoth")
  }
  return mammothLib
}

export class DocxProcessor implements FileProcessor {
  canProcess(file: File): boolean {
    const extension = this.getFileExtension(file.name).toLowerCase()
    return (
      extension === ".docx" ||
      file.type ===
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    )
  }

  async process(file: File): Promise<ProcessedFile> {
    try {
      const mammoth = await getMammothLib()
      const arrayBuffer = await file.arrayBuffer()

      // Convert DOCX to HTML first, then extract text
      const result = await mammoth.extractRawText({ arrayBuffer })

      // Also try to get HTML for better formatting preservation
      const htmlResult = await mammoth.convertToHtml({ arrayBuffer })

      // Use raw text, but include HTML as additional context if available
      const text =
        result.value.trim() ||
        htmlResult.value ||
        "(No text content found in DOCX)"

      return {
        text,
        metadata: {
          fileName: file.name,
          fileType:
            file.type ||
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          fileSize: file.size,
          processedAt: Date.now()
        }
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error"
      throw new Error(`Failed to process DOCX: ${errorMessage}`)
    }
  }

  private getFileExtension(fileName: string): string {
    const lastDot = fileName.lastIndexOf(".")
    return lastDot !== -1 ? fileName.slice(lastDot) : ""
  }
}
