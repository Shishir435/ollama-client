import type { FileProcessor, ProcessedFile } from "@/lib/file-processors/types"
import { HtmlLoader } from "@/lib/loaders/html-loader"

/**
 * HTML File Processor
 * Converts HTML files to Markdown for clean text extraction
 */
export class HtmlProcessor implements FileProcessor {
  canProcess(file: File): boolean {
    const extension = this.getFileExtension(file.name).toLowerCase()

    // Check file extension
    if ([".html", ".htm"].includes(extension)) {
      return true
    }

    // Check MIME type
    if (file.type === "text/html") {
      return true
    }

    return false
  }

  async process(file: File): Promise<ProcessedFile> {
    try {
      // Read HTML content
      const html = await file.text()

      // Create HTML loader
      const loader = new HtmlLoader({
        html,
        url: file.name
      })

      // Load and convert to markdown
      const docs = await loader.load()

      // Combine documents (should be only one)
      const text = docs.map((doc) => doc.pageContent).join("\n\n")

      return {
        text,
        metadata: {
          fileName: file.name,
          fileType: file.type || "text/html",
          fileSize: file.size,
          processedAt: Date.now()
        }
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error"
      throw new Error(`Failed to process HTML file: ${errorMessage}`)
    }
  }

  private getFileExtension(fileName: string): string {
    const lastDot = fileName.lastIndexOf(".")
    return lastDot !== -1 ? fileName.slice(lastDot) : ""
  }
}
